require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const Visit = require('./models/Visit');

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

// TikWM API'den linkleri al
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
      username: data.data.author?.unique_id || 'unknown'
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

// Proxy download route (mp3/mp4)
const Download = require('./models/Download');

// Proxy route içine ekle:
app.get('/proxy-download', async (req, res) => {
  const { url, username, type } = req.query;
  if (!url) return res.status(400).send('Video linki yok');

  // ✅ Download log ekle
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url, ip }).save();

  const timestamp = Date.now();
  const extension = (type === 'music') ? 'mp3' : 'mp4';
  const filename = sanitize(`ttdownload_@${username || 'unknown'}_${timestamp}.${extension}`);

  https.get(url, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('İndirme hatası');
  });
});


// ✅ Admin login sayfası
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

// ✅ Admin dashboard (giriş sonrası)
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.authenticated) return res.redirect('/admin/login');

  const total = await Visit.countDocuments();
  const today = await Visit.countDocuments({
    createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
  });
  const visits = await Visit.find().sort({ createdAt: -1 }).limit(20);

  res.render('admin/dashboard', { total, today, visits });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
