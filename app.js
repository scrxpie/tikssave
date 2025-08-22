require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { spawn } = require('child_process');
const axios = require('axios');
const Visit = require('./models/Visit');
const Download = require('./models/Download');
const VideoLink = require('./models/VideoLink'); // TikTok modeli
const InstagramVideoLink = require('./models/InstagramVideoLink'); // Instagram modeli
const { customAlphabet } = require('nanoid');

const app = express();
const port = process.env.PORT || 3000;
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);
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
  .catch(err => console.error('MongoDB connection error:', err));


// --- ROTLAR ---
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count, videoData: null });
});
app.get('/discord', (req, res) => res.render('discord'));
app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/terms', (req, res) => res.render('terms'));
app.get('/rights', (req, res) => res.render('rights'));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/dashboard' }),
  (req, res) => res.redirect('/dashboard')
);
app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.render('dashboard', { user: null, guilds: null });
  }
  const user = req.user;
  const guilds = user.guilds;
  const manageableGuilds = guilds.filter(guild => (guild.permissions & 0x20) === 0x20 || (guild.permissions & 0x8) === 0x8);
  res.render('dashboard', { user: user, guilds: manageableGuilds });
});

// --- API ROTLARI (Kendi Scraper'ınızla) ---

// TikTok İşleme Rotası

// TikTok İşleme Rotası
const Tiktok = require('@tobyg74/tiktok-api-dl'); // Paketi içeri aktar

app.post('/api/tiktok-process', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, message: 'URL belirtilmedi.' });
    }
    
    // Doğrudan NPM paketini kullan
    try {
        const tiktokData = await Tiktok.Downloader(url, { version: 'v3' });
        
        // NPM paketinden gelen ham veriyi logla
        console.log('NPM paketinden gelen ham veri:', tiktokData);
        
        if (tiktokData && tiktokData.status === 'success' && tiktokData.result) {
            const result = tiktokData.result;
            const formattedData = {
                id: result.id,
                author: {
                    unique_id: result.author?.unique_id || 'unknown',
                    nickname: result.author?.nickname || 'unknown',
                    avatar: result.author?.avatar || 'unknown'
                },
                title: result.title || '',
                cover: result.cover?.[0] || '',
                play: result.video_no_watermark || '',
                hdplay: result.video_no_watermark_hd || '',
                music: result.music || '',
                stats: {
                    play_count: result.stats?.play_count || 0,
                    digg_count: result.stats?.digg_count || 0,
                    comment_count: result.stats?.comment_count || 0,
                    share_count: result.stats?.share_count || 0
                }
            };
            
            // Veritabanına kaydetmek için doğru veriyi döndür
            const videoInfo = formattedData;
            let shortId;
            let exists;
            do {
                shortId = generateShortId();
                exists = await VideoLink.findOne({ shortId });
            } while (exists);

            const newVideoLink = new VideoLink({
                shortId,
                originalUrl: url,
                videoInfo: videoInfo,
            });

            await newVideoLink.save();
            return res.json({ success: true, shortId, videoInfo });

        } else {
            return res.status(500).json({ success: false, message: 'NPM paketinden veri alınamadı.' });
        }
    } catch (error) {
        console.error('NPM paketi hatası:', error.message);
        return res.status(500).json({ success: false, message: 'API hatası.' });
    }
});

// ... Instagram İşleme Rotası ve diğer kodlar ...
// ...
    
});
// Instagram İşleme Rotası
app.post('/api/instagram-process', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, message: 'URL yok' });
  }

  try {
    const pythonProcess = spawn('python3', ['./scrapers/insta_scraper.py', url]);
    let rawData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => rawData += data.toString());
    pythonProcess.stderr.on('data', (data) => errorData += data.toString());

    pythonProcess.on('close', async (code) => {
      if (code !== 0) {
        console.error('Python Hata Çıktısı:', errorData);
        return res.status(500).json({ success: false, message: 'Instagram verisi işlenirken bir hata oluştu.' });
      }
      
      try {
        const apiData = JSON.parse(rawData);
        if (!apiData.success) {
          return res.status(400).json({ success: false, message: apiData.message || 'Video bilgisi alınamadı.' });
        }
        
        const videoInfo = apiData.data;
        let shortId;
        let exists;
        do {
          shortId = generateShortId();
          exists = await InstagramVideoLink.findOne({ shortId });
        } while (exists);
        
        const newVideoLink = new InstagramVideoLink({
          shortId,
          originalUrl: url,
          videoInfo: videoInfo,
        });

        await newVideoLink.save();
        res.json({ success: true, shortId, videoInfo });

      } catch (parseError) {
        console.error('JSON parse hatası:', parseError);
        res.status(500).json({ success: false, message: 'Sunucu hatası: JSON ayrıştırılamadı.' });
      }
    });
  } catch (err) {
    console.error('Spawn hatası:', err.message);
    res.status(500).json({ success: false, message: 'Sunucu hatası: İşlem başlatılamadı.' });
  }
});

// Bilgi Çekme Rotası (TikTok)
app.get('/api/info/:shortId', async (req, res) => {
  const { shortId } = req.params;
  try {
    const videoLink = await VideoLink.findOne({ shortId });
    if (!videoLink) return res.status(404).json({ success: false, message: 'Video bulunamadı.' });
    if (!videoLink.videoInfo) return res.status(404).json({ success: false, message: 'Video bilgileri eksik.' });
    res.json({ success: true, videoInfo: videoLink.videoInfo });
  } catch (err) {
    console.error('API bilgi çekme hatası:', err);
    res.status(500).json({ success: false, message: 'Sunucu hatası.' });
  }
});

// Bilgi Çekme Rotası (Instagram)
app.get('/api/instagram/info/:shortId', async (req, res) => {
    const { shortId } = req.params;
    try {
      const videoLink = await InstagramVideoLink.findOne({ shortId });
      if (!videoLink) return res.status(404).json({ success: false, message: 'Video bulunamadı.' });
      if (!videoLink.videoInfo) return res.status(404).json({ success: false, message: 'Video bilgileri eksik.' });
      res.json({ success: true, videoInfo: videoLink.videoInfo });
    } catch (err) {
      console.error('API bilgi çekme hatası:', err);
      res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});


// Proxy İndirme Rotası
app.get('/proxy-download', async (req, res) => {
  const { shortId, username, type } = req.query;
  let videoUrl, videoUsername;
  
  try {
    const videoLink = await VideoLink.findOne({ shortId });
    if (!videoLink || !videoLink.videoInfo) {
      return res.status(404).send('Video not found or info is missing.');
    }
    videoUrl = videoLink.videoInfo.hdplay || videoLink.videoInfo.play;
    videoUsername = videoLink.videoInfo.author?.unique_id || 'unknown';
  } catch (dbErr) {
    console.error('Database lookup error:', dbErr);
    return res.status(500).send('Database error.');
  }

  if (!videoUrl) {
    return res.status(400).send('Video link is missing.');
  }

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url: videoUrl, ip }).save();
  const extension = (type === 'music') ? 'mp3' : 'mp4';
  const safeUsername = sanitize((videoUsername || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
  const filename = `tikssave_${safeUsername}_${Date.now()}.${extension}`;

  https.get(videoUrl, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('Download error.');
  });
});

// Eski rotalar
app.post('/get-links', (req, res) => {
    res.status(404).send('Bu rota kaldırılmıştır, lütfen yeni API rotasını kullanın.');
});

// Video Görüntüleme Rotası
app.get('/:shortId', async (req, res) => {
  const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
  if (!videoLink) {
    return res.status(404).send('Video bulunamadı');
  }

  let videoData = videoLink.videoInfo;
  
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isDiscordOrTelegram = userAgent.includes('discordbot') || userAgent.includes('telegrambot');
  const acceptsVideo = (req.headers['accept'] || '').includes('video/mp4');
  if (isDiscordOrTelegram || acceptsVideo) {
    if (videoData.hdplay || videoData.play) {
      return res.redirect(307, videoData.hdplay || videoData.play);
    }
  }
  res.render('index', { videoData });
});


app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
