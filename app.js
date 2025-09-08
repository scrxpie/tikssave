require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const axios = require('axios');

const Visit = require('./models/Visit');
const VideoLink = require('./models/VideoLink');
// const Download = require('./models/Download'); // Eğer bir Download modelin varsa bunu aç
let Download; // Eski koddaki hatalı import yüzünden try/catch ile koruyacağız

const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);

const app = express();
const port = process.env.PORT || 3000;

// Discord OAuth2
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;

// --- PROXY LİSTELERİ ---
const TIKTOK_PROXIES = [
  process.env.PROXY1_URL,
  process.env.PROXY2_URL,
  process.env.PROXY3_URL,
];
const INSTAGRAM_PROXIES = [
  process.env.INSTA_PROXY_URL
];

function getRandomProxy(proxies) {
  if (!proxies || proxies.length === 0) throw new Error("Proxy listesi boş.");
  const index = Math.floor(Math.random() * proxies.length);
  return proxies[index];
}

// --- TİKTOK ---
async function fetchTikTokVideoFromProxy(url) {
  const tried = new Set();
  for (let i = 0; i < TIKTOK_PROXIES.length; i++) {
    const proxy = getRandomProxy(TIKTOK_PROXIES);
    if (tried.has(proxy)) continue;
    tried.add(proxy);

    try {
      const response = await axios.post(proxy, { url }, { timeout: 10000 });
      if (response.data && response.data.code === 0 && response.data.data) {
        return response.data.data;
      }
    } catch (error) {
      console.error(`❌ TikTok Proxy hatası: ${proxy} - ${error.message}`);
    }
  }
  throw new Error("Tüm TikTok proxyleri başarısız oldu veya limit aşıldı");
}

// --- INSTAGRAM ---
async function fetchInstagramMedia(url) {
  const tried = new Set();
  for (let i = 0; i < INSTAGRAM_PROXIES.length; i++) {
    const proxy = getRandomProxy(INSTAGRAM_PROXIES);
    if (tried.has(proxy)) continue;
    tried.add(proxy);

    try {
      const headers = { 'x-source': 'bot' };
      const response = await axios.post(proxy, { url }, { timeout: 30000, headers });
      if (response.data) return response.data;
    } catch (error) {
      console.error(`❌ Instagram Proxy hatası: ${error.message}`);
    }
  }
  throw new Error("Tüm Instagram proxyleri başarısız oldu veya limit aşıldı");
}

// EJS & Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session & Passport
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new DiscordStrategy({
  clientID: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  callbackURL: CALLBACK_URL,
  scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error(err));

// --- ROUTES ---
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count, videoData: null });
});

app.get('/ads.txt', (req, res) => res.redirect('https://srv.adstxtmanager.com/19390/tikssave.xyz'));
app.get('/discord', (req, res) => res.render('discord'));
app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/terms', (req, res) => res.render('terms'));
app.get('/rights', (req, res) => res.render('rights'));

// Dashboard
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/dashboard' }),
  (req, res) => res.redirect('/dashboard')
);
app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) return res.render('dashboard', { user: null, guilds: null });
  const user = req.user;
  const manageableGuilds = user.guilds.filter(guild => (guild.permissions & 0x20) === 0x20 || (guild.permissions & 0x8) === 0x8);
  res.render('dashboard', { user, guilds: manageableGuilds });
});

// --- API ROTLARI ---
// TikTok
app.post('/api/tiktok-process', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });
  try {
    const videoInfo = await fetchTikTokVideoFromProxy(url);
    let shortId, exists;
    do {
      shortId = nanoid();
      exists = await VideoLink.findOne({ shortId });
    } while (exists);

    const newVideoLink = new VideoLink({ shortId, originalUrl: url, videoInfo });
    await newVideoLink.save();
    res.json({ success: true, shortId, videoInfo });
  } catch {
    res.status(500).json({ success: false, message: 'Tüm proxyler başarısız oldu veya limit aşıldı.' });
  }
});

// Instagram
app.post('/api/instagram-process', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });
  try {
    const mediaInfo = await fetchInstagramMedia(url);
    let shortId, exists;
    do {
      shortId = nanoid();
      exists = await VideoLink.findOne({ shortId });
    } while (exists);

    const newVideoLink = new VideoLink({ shortId, originalUrl: url, videoInfo: mediaInfo });
    await newVideoLink.save();
    res.json({ success: true, shortId, mediaInfo });
  } catch {
    res.status(500).json({ success: false, message: 'Instagram proxy hatası veya limit aşıldı.' });
  }
});

// Instagram (Web formu)
app.post('/api/instagram-download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });
  try {
    const mediaInfo = await fetchInstagramMedia(url);
    res.json({ success: true, data: mediaInfo });
  } catch (err) {
    console.error('Web Instagram API işleme hatası:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Beklenmedik bir hata oluştu.' });
  }
});

// ShortId ile info çek (TikTok/Instagram Info butonu için)
app.get('/api/info/:shortId', async (req, res) => {
  try {
    const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
    if (!videoLink || !videoLink.videoInfo) return res.status(404).json({ success: false, message: 'Video bulunamadı veya bilgiler eksik.' });
    res.json({ success: true, videoInfo: videoLink.videoInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Sunucu hatası.' });
  }
});

/* =========================
   TWITTER (shortId YOK!)
   ========================= */

// /api/twitter-process: sadece statusId parse eder ve bizim sitedeki direkt indirme linkini döner
app.post('/api/twitter-process', async (req, res) => {
  const { url: tweetUrl } = req.body;
  if (!tweetUrl) return res.status(400).json({ success: false, message: 'URL yok' });

  try {
    const regex = /(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/(\d+)/;
    const match = tweetUrl.match(regex);
    if (!match) return res.status(400).json({ success: false, message: 'Geçersiz Twitter/X URL' });

    const statusId = match[1];

    // Bizim sitedeki direkt indirme endpoint’i
    const dlUrl = `${process.env.SITE_URL}/twitter-download/${statusId}`;
    res.json({
      success: true,
      statusId,
      downloadUrl: dlUrl,
      // İstersen client tarafında göstermek için raw fixup linkleri de dönüyorum (UI gerekirse)
      raw: {
        mp4: `https://d.fixupx.com/i/status/${statusId}.mp4`,
        jpg: `https://d.fixupx.com/i/status/${statusId}.jpg`
      }
    });
  } catch (err) {
    console.error('Twitter process error:', err.message);
    res.status(500).json({ success: false, message: 'Twitter işleme hatası' });
  }
});

// /twitter-download/:statusId → direkt dosya (mp4 varsa mp4, yoksa jpg). İsim: tikssave_<statusId>.<ext>
app.get('/twitter-download/:statusId', async (req, res) => {
  try {
    const statusId = req.params.statusId;
    if (!statusId) return res.status(400).send('Tweet ID yok');

    const fixupVideoUrl = `https://d.fixupx.com/i/status/${statusId}.mp4`;
    const fixupPhotoUrl = `https://d.fixupx.com/i/status/${statusId}.jpg`;

    // Önce video var mı?
    const headVideo = await axios.head(fixupVideoUrl).catch(() => null);
    if (headVideo && headVideo.status === 200) {
      const filename = `tikssave_${statusId}.mp4`;
      const streamRes = await axios.get(fixupVideoUrl, { responseType: 'stream' });
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'video/mp4');
      return streamRes.data.pipe(res);
    }

    // Değilse foto var mı?
    const headPhoto = await axios.head(fixupPhotoUrl).catch(() => null);
    if (headPhoto && headPhoto.status === 200) {
      const filename = `tikssave_${statusId}.jpg`;
      const streamRes = await axios.get(fixupPhotoUrl, { responseType: 'stream' });
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'image/jpeg');
      return streamRes.data.pipe(res);
    }

    return res.status(404).send('Tweet medyası bulunamadı');
  } catch (err) {
    console.error('Twitter download error:', err.message);
    res.status(500).send('Sunucu hatası');
  }
});

/* =========================
   GENEL PROXY DOWNLOAD
   (TikTok/Instagram için)
   ========================= */
app.get('/proxy-download', async (req, res) => {
  try {
    const { url, username, type, shortId } = req.query;
    let videoUrl = url;

    if (shortId) {
      try {
        const videoLink = await VideoLink.findOne({ shortId });
        if (!videoLink || !videoLink.videoInfo) return res.status(404).send('Video bulunamadı');

        const isInstagram = videoLink.originalUrl.includes('instagram.com') || videoLink.originalUrl.includes('instagr.am');

        if (isInstagram) {
          videoUrl = videoLink.videoInfo.media_url;
        } else {
          videoUrl = videoLink.videoInfo.hdplay || videoLink.videoInfo.play || videoLink.videoInfo.media_url;
        }
      } catch (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }
    }

    if (!videoUrl) return res.status(400).send('Video link yok');

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    // İsteğe bağlı download kaydı (Download modelin yoksa sorun çıkarmasın)
    try {
      if (Download && typeof Download.create === 'function') {
        await Download.create({ url: videoUrl, ip });
      }
    } catch (e) {
      // sessiz geç
    }

    const extension = (type === 'music') ? 'mp3' : videoUrl.endsWith('.mp4') ? 'mp4' : 'jpg';
    const safeUsername = sanitize((username || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
    const filename = `tikssave_${safeUsername}_${Date.now()}.${extension}`;

    try {
      const videoRes = await axios.get(videoUrl, {
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
        },
        timeout: 15000
      });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return videoRes.data.pipe(res);
    } catch (err) {
      console.error('Download error:', err.message);
      return res.status(500).send('Download error');
    }
  } catch (err) {
    console.error('Proxy download error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ShortId redirect (Discord/Telegram önizleme + web render)
app.get('/:shortId', async (req, res) => {
  try {
    const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
    if (!videoLink) return res.status(404).send('Video bulunamadı');

    let videoData = videoLink.videoInfo;
    const isInstagram = videoLink.originalUrl.includes('instagram.com') || videoLink.originalUrl.includes('instagr.am');
    const isTwitter = videoLink.originalUrl.includes('twitter.com') || videoLink.originalUrl.includes('x.com');

    try {
      if (isInstagram) {
        const freshData = await fetchInstagramMedia(videoLink.originalUrl);
        videoData = freshData;
        videoLink.videoInfo = freshData;
      } else if (!isTwitter) {
        // TikTok için refresh
        const freshData = await fetchTikTokVideoFromProxy(videoLink.originalUrl);
        videoData = freshData;
        videoLink.videoInfo = freshData;
      }
      await videoLink.save();
    } catch (err) {
      console.error('Yeniden fetch hatası:', err.message);
      // videoData mevcut haliyle kalsın
    }

    if (!videoData) return res.status(404).send('Video bilgisi alınamadı');

    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const isDiscordOrTelegram = userAgent.includes('discordbot') || userAgent.includes('telegrambot');
    const acceptsVideo = (req.headers['accept'] || '').includes('video/mp4');

    // Twitter shortId'li sistem kullanmıyoruz, ama eğer bir şekilde kaydedilmişse
    // burada fixup linkine 307 yönlendirme yapılır
    if (isDiscordOrTelegram || acceptsVideo) {
      const redirectUrl = isTwitter
        ? (videoData.media_url || '')
        : (videoData.hdplay || videoData.play || videoData.media_url);

      if (redirectUrl) return res.redirect(307, redirectUrl);
    }

    // Web render
    res.render('index', { videoData });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
