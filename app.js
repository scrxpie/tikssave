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

// --- ROTLAR ---

app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count, videoData: null });
});

app.get('/ads.txt', (req, res) => {
  res.redirect('https://srv.adstxtmanager.com/19390/tikssave.xyz');
});
app.get('/discord', (req, res) => { res.render('discord'); });
app.get('/privacy', (req, res) => { res.render('privacy'); });
app.get('/terms', (req, res) => { res.render('terms'); });
app.get('/rights', (req, res) => { res.render('rights'); });

// --- Discord Dashboard ---

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/dashboard' }),
  (req, res) => res.redirect('/dashboard')
);

app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.render('dashboard', { user: null, guilds: null });

  const user = req.user;
  const guilds = user.guilds || [];
  const manageableGuilds = guilds.filter(guild => (guild.permissions & 0x20) === 0x20 || (guild.permissions & 0x8) === 0x8);

  res.render('dashboard', { user, guilds: manageableGuilds });
});

// --- TikTok API Helper Fonksiyonları ---

async function fetchFromTikWM(url) {
  try {
    const tikwmRes = await axios.post('https://www.tikwm.com/api/', { url });
    const tikwmData = tikwmRes.data;
    if (tikwmData.code !== 0 || !tikwmData.data) throw new Error(tikwmData.msg || 'TikWM API hatası');
    return tikwmData.data;
  } catch (err) {
    console.error('TikWM hatası:', err.message);
    throw err;
  }
}

async function fetchFromRapidAPI(url) {
  try {
    const response = await axios.get(
      `https://tiktok-scraper7.p.rapidapi.com/?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
          "X-RapidAPI-Host": "tiktok-scraper7.p.rapidapi.com"
        }
      }
    );
    const data = response.data;
    return {
      id: data.id,
      author: data.author,
      title: data.description,
      cover: data.cover,
      play: data.videoUrl,
      hdplay: data.videoUrl,
      music: data.music || '',
      play_count: data.stats?.playCount || 0,
      digg_count: data.stats?.diggCount || 0,
      comment_count: data.stats?.commentCount || 0,
      share_count: data.stats?.shareCount || 0,
      create_time: data.createTime || Date.now()
    };
  } catch (err) {
    console.error('RapidAPI hatası:', err.message);
    throw err;
  }
}

// --- TikTok API Rotası (TikWM + RapidAPI fallback) ---

app.post('/api/tiktok-process', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

  let videoInfo;
  try { videoInfo = await fetchFromTikWM(url); }
  catch { 
    console.log('TikWM başarısız, RapidAPI fallback çalışıyor...');
    try { videoInfo = await fetchFromRapidAPI(url); }
    catch { return res.status(500).json({ success: false, message: 'Tüm API’ler başarısız.' }); }
  }

  try {
    let shortId, exists;
    do { shortId = generateShortId(); exists = await VideoLink.findOne({ shortId }); } while (exists);

    const newVideoLink = new VideoLink({ shortId, originalUrl: url, videoInfo });
    await newVideoLink.save();

    console.log(`Yeni video bağlantısı kaydedildi: ${shortId}`);
    res.json({ success: true, shortId, videoInfo });
  } catch (dbErr) {
    console.error('Veritabanı hatası:', dbErr);
    res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
  }
});

// --- Info Rotası ---
app.get('/api/info/:shortId', async (req, res) => {
  try {
    const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
    if (!videoLink || !videoLink.videoInfo) return res.status(404).json({ success: false, message: 'Video bulunamadı.' });
    res.json({ success: true, videoInfo: videoLink.videoInfo });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Sunucu hatası.' }); }
});

// --- Proxy Download ---
app.get('/proxy-download', async (req, res) => {
  const { shortId, type } = req.query;
  try {
    const videoLink = await VideoLink.findOne({ shortId });
    if (!videoLink || !videoLink.videoInfo) return res.status(404).send('Video bulunamadı.');

    const videoUrl = videoLink.videoInfo.hdplay || videoLink.videoInfo.play;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    await new Download({ url: videoUrl, ip }).save();

    const extension = (type === 'music') ? 'mp3' : 'mp4';
    const safeUsername = sanitize((videoLink.videoInfo.author?.unique_id || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
    const filename = `tikssave_${safeUsername}_${Date.now()}.${extension}`;

    https.get(videoUrl, fileRes => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      fileRes.pipe(res);
    }).on('error', err => { console.error(err); res.status(500).send('Download error.'); });

  } catch (err) { console.error(err); res.status(500).send('Sunucu hatası.'); }
});

// --- ShortId Route ---
app.get('/:shortId', async (req, res) => {
  const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
  if (!videoLink) return res.status(404).send('Video bulunamadı');

  let videoData = videoLink.videoInfo;
  res.render('index', { videoData });
});

// --- Server Start ---
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
