require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const Visit = require('./models/Visit');
const Download = require('./models/Download');
const VideoLink = require('./models/VideoLink');
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Discord OAuth2 bilgileri .env dosyasından çekiliyor
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Yardımcı fonksiyonlar
function generateShortId() {
  return nanoid();
}

// EJS ve static dosyalar
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session ve Passport ayarları
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Discord OAuth2 stratejisi
passport.use(new DiscordStrategy({
  clientID: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  callbackURL: CALLBACK_URL,
  scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// MongoDB bağlantısı
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));


// --- MIDDLEWARE'LER ---

// Discord ile giriş yapmış kullanıcının bilgilerini kontrol etmek için
const discordAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/dashboard');
};

// Admin şifresiyle giriş yapmış kullanıcının session'ını kontrol etmek için
const adminAuthenticated = (req, res, next) => {
  if (req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
};


// --- ROTLAR ---

// Ana sayfa
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count, videoData: null });
});

// Discord sayfası
app.get('/discord', (req, res) => {
  res.render('discord');
});

// Privacy, Terms ve Rights sayfaları
app.get('/privacy', (req, res) => {
  res.render('privacy');
});

app.get('/terms', (req, res) => {
  res.render('terms');
});

app.get('/rights', (req, res) => {
  res.render('rights');
});


// --- DİSCORD DASHBOARD ROTLARI ---

// OAuth akışını başlatan rota
app.get('/auth/discord', passport.authenticate('discord'));

// OAuth callback rotası
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/dashboard' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

// Ana Discord Dashboard sayfası
app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.render('dashboard', { user: null, guilds: null });
  }

  const user = req.user;
  const guilds = user.guilds;

  const manageableGuilds = guilds.filter(guild => {
    return (guild.permissions & 0x20) === 0x20 || (guild.permissions & 0x8) === 0x8;
  });

  res.render('dashboard', { user: user, guilds: manageableGuilds });
});


// --- GENEL ADMIN ROTLARI ---

// Admin giriş sayfası
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

// Admin giriş formunu işleyen rota
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  } else {
    res.render('admin/login', { error: 'Incorrect password.' });
  }
});

// Admin Dashboard sayfası
app.get('/admin/dashboard', adminAuthenticated, (req, res) => {
  res.render('admin/dashboard');
});

// Diğer admin rotalarını buraya ekleyebilirsin...
// app.get('/admin/stats', adminAuthenticated, (req, res) => { ... });
// app.post('/admin/videos', adminAuthenticated, (req, res) => { ... });


// --- API ROTLARI ---

app.post('/get-links', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video bilgisi alınamadı.' });
    }
    res.json({
      success: true,
      play: data.data.play,
      hdplay: data.data.hdplay,
      music: data.data.music,
      username: data.data.author?.unique_id || 'unknown',
      title: data.data.title,
      cover: data.data.cover
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

app.get('/proxy-download', async (req, res) => {
  const { url, username, type } = req.query;
  if (!url) return res.status(400).send('Video linki yok');
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url, ip }).save();
  const extension = type === 'music' ? 'mp3' : 'mp4';
  const safeUsername = sanitize((username || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
  const filename = `ttdownload_${safeUsername}_${Date.now()}.${extension}`;
  console.log('Filename:', filename);
  https.get(url, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('İndirme hatası.');
  });
});

app.post('/tiktok', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });
  try {
    let shortId;
    let exists;
    do {
      shortId = generateShortId();
      exists = await VideoLink.findOne({ shortId });
    } while (exists);
    const newVideoLink = new VideoLink({
      shortId,
      originalUrl: url
    });
    await newVideoLink.save();
    console.log('Depolanan video:', newVideoLink);
    res.json({ success: true, shortId });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

app.get('/:shortId', async (req, res) => {
  const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
  if (!videoLink) {
    return res.status(404).send('Video bulunamadı');
  }
  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(videoLink.originalUrl)}`);
    const data = await response.json();
    if (!data || data.code !== 0) {
      return res.status(404).send('Video bilgisi alınamadı.');
    }
    const videoData = {
      play: data.data.play,
      hdplay: data.data.hdplay,
      music: data.data.music,
      username: data.data.author?.unique_id || 'unknown',
      title: data.data.title,
      cover: data.data.cover
    };
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const isDiscordOrTelegram = userAgent.includes('discordbot') || userAgent.includes('telegrambot');
    const acceptsVideo = (req.headers['accept'] || '').includes('video/mp4');
    if (isDiscordOrTelegram || acceptsVideo) {
      if (videoData.hdplay || videoData.play) {
        return res.redirect(307, videoData.hdplay || videoData.play);
      }
    }
    res.render('index', { videoData });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası.');
  }
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
