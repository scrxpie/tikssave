require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const sanitize = require('sanitize-filename');
const Visit = require('./models/Visit');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // JSON body için

// MongoDB bağlantısı
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Ana Sayfa
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count });
});

// TikWM üzerinden linkleri al
app.post('/get-links', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video info alınamadı.' });
    }

    const links = {
      success: true,
      play: data.data.play,
      hdplay: data.data.hdplay,
      music: data.data.music,
      username: data.data.author?.unique_id || 'unknown'
    };

    res.json(links);
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

// İndirme işlemi (proxy olarak)
app.get('/proxy-download', (req, res) => {
  const { url, username } = req.query;
  if (!url) return res.status(400).send('Video linki yok');

  const timestamp = Date.now();
  const filename = sanitize(`ttdownload_@${username || 'unknown'}_${timestamp}.mp4`);

  https.get(url, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('İndirme hatası');
  });
});

// Admin Paneli
app.get('/admin', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).send('Unauthorized');
  }
  Visit.find().sort({ createdAt: -1 }).limit(20).then(visits => {
    res.render('admin', { visits });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
