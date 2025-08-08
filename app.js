require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const Visit = require('./models/Visit');
const Download = require('./models/Download');
const VideoLink = require('./models/VideoLink'); // Kullanılıyor ama save yok artık
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);

const app = express();

function generateShortId() {
  return nanoid();
}

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// Ana sayfa
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count, videoData: null }); // videoData null çünkü ana sayfa
});

// TikTok API bilgisi (bu endpoint artık sadece veriyi döner, kaydetmez)
app.post('/tiktok', async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video bilgisi alınamadı.' });
    }

    // Kaydetme işlemi yok, direkt video verisini dönüyoruz
    res.json({
      success: true,
      video: {
        play: data.data.play,
        hdplay: data.data.hdplay,
        music: data.data.music,
        username: data.data.author?.unique_id || 'unknown',
        title: data.data.title,
        cover: data.data.cover
      }
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

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

app.get('/discord', (req, res) => {
  res.render('discord'); // views/discord.ejs dosyasını açacak
});

// Proxy indir
app.get('/proxy-download', async (req, res) => {
  const { url, username, type } = req.query;
  if (!url) return res.status(400).send('Video linki yok');

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url, ip }).save();

  const extension = type === 'music' ? 'mp3' : 'mp4';
  const safeUsername = sanitize((username || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
  const filename = `ttdownload_${safeUsername}_${Date.now()}.${extension}`;

  https.get(url, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('İndirme hatası.');
  });
});

app.get('/privacy', (req, res) => {
  res.render('privacy');
});

app.get('/contact', (req, res) => {
  res.render('contact');
});

app.get('/terms', (req, res) => {
  res.render('terms');
});

app.get('/rights', (req, res) => {
  res.render('rights');
});

// GET /:shortId → embed veya önizleme göster (artık db'den bir şey gelmeyecek, VideoLink kaydı yok)
app.get('/:shortId', async (req, res) => {
  // artık db'de kayıt olmadığı için videoData çekilmiyor
  // dilersen bu route'u iptal edebilirsin ya da sadece hata dönersin
  res.status(404).send('Video bulunamadı veya kayıt edilmemiş.');
});

// Admin panel
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

app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.authenticated) return res.redirect('/admin/login');

  const total = await Visit.countDocuments();
  const today = await Visit.countDocuments({
    createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
  });

  const uniqueVisitors = await Visit.distinct('ip');
  const totalDownloads = await Download.countDocuments();
  const visits = await Visit.find().sort({ createdAt: -1 }).limit(20);

  res.render('admin/dashboard', {
    total,
    today,
    totalUnique: uniqueVisitors.length,
    totalDownloads,
    visits
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
