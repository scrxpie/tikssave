require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const Visit = require('./models/Visit');

const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);

function generateShortId() {
  return nanoid();
}

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Oturum yönetimi
app.use(session({
  secret: process.env.ADMIN_PASSWORD,
  resave: false,
  saveUninitialized: true
}));

// MongoDB bağlantısı
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Ana sayfa + sayaç
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count });
});

// TikWM API'den linkleri al (video bilgisi)
app.post('/get-links', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video info alınamadı.' });
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

// Proxy download route (mp3/mp4)
const Download = require('./models/Download');

app.get('/proxy-download', async (req, res) => {
  const { url, username, type } = req.query;
  if (!url) return res.status(400).send('Video linki yok');

  // Download log ekle
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url, ip }).save();

  const timestamp = Date.now();
  const extension = (type === 'music') ? 'mp3' : 'mp4';
  const safeUsername = (username || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
const filename = sanitize(`ttdownload_${safeUsername}_${timestamp}.${extension}`);
  https.get(url, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('İndirme hatası');
  });
});

// Yeni: kısa link üret ve dön
const videoCache = new Map(); // shortId => gerçek video url ve meta verisi (basit cache)

// /tiktok komutu mantığı - shortId üret, cachele, dön
const VideoLink = require('./models/VideoLink'); // model dosyasının yolu

// generateShortId fonksiyonu aynen kalabilir

// /tiktok endpoint'i POST: kısa link oluştur ve MongoDB'ye kaydet
app.post('/tiktok', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

  try {
    // TikWM API'den video bilgisi al
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video bilgisi alınamadı.' });
    }

    // Kısa ID oluştur
    let shortId;
    let exists;
    do {
      shortId = generateShortId();
      exists = await VideoLink.findOne({ shortId });
    } while (exists);

    // MongoDB'ye kaydet
    const newVideoLink = new VideoLink({
      shortId,
      play: data.data.play,
      hdplay: data.data.hdplay,
      music: data.data.music,
      username: data.data.author?.unique_id || 'unknown',
      title: data.data.title,
      cover: data.data.cover
    });
    await newVideoLink.save();

    res.json({ success: true, shortId });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

// /:shortId route'u: veritabanından çek ve sayfa render et
app.get('/:shortId', async (req, res) => {
  const { shortId } = req.params;

  try {
    const videoData = await VideoLink.findOne({ shortId });
    if (!videoData) return res.status(404).send('Video bulunamadı.');

    const videoUrl = videoData.hdplay || videoData.play;
    if (!videoUrl) return res.status(404).send('Video linki bulunamadı.');

    // Video dosyasını direkt sun (proxy)
    https.get(videoUrl, fileRes => {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `inline; filename="${sanitize(videoData.title || 'video')}.mp4"`);
      fileRes.pipe(res);
    }).on('error', err => {
      console.error(err);
      res.status(500).send('Video akışı başarısız.');
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası.');
  }
});

  // videoData'yı sayfaya gönder
  


// Admin login sayfası
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/admin/dashboard');
  } else {
    res.render('admin/login', { error: 'Wrong password' });
  }
});

// Admin dashboard
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.authenticated) return res.redirect('/admin/login');

  const total = await Visit.countDocuments();
  const today = await Visit.countDocuments({
    createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
  });

  const uniqueVisitors = await Visit.distinct('ip');
  const totalUnique = uniqueVisitors.length;

  const totalDownloads = await Download.countDocuments();

  const visits = await Visit.find().sort({ createdAt: -1 }).limit(20);

  res.render('admin/dashboard', {
    total,
    today,
    totalUnique,
    totalDownloads,
    visits
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
