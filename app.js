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
const VideoLink = require('./models/VideoLink');
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

// TikTok API bilgisi
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

// Proxy indir
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

// Kısa bağlantı oluştur (POST /tiktok)
app.post('/tiktok', async (req, res) => {
  const { url } = req.body;
  const isBot = req.headers['x-source'] === 'bot';

  if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!data || data.code !== 0) {
      return res.json({ success: false, message: 'Video bilgisi alınamadı.' });
    }

    // Eğer bot değilse sadece bilgileri döndür
    if (!isBot) {
      return res.json({
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
    }

    // BOT'tan geldiyse kaydet (depolama işlemi)
    let shortId;
    let exists;
    do {
      shortId = generateShortId();
      exists = await VideoLink.findOne({ shortId });
    } while (exists);

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
    console.log('Depolanan video:', newVideoLink);

    res.json({ success: true, shortId });

  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Sunucu hatası.' });
  }
});

// GET /:shortId → Ana sayfada link girilmiş gibi göster
app.get('/:shortId', async (req, res) => {
  const { shortId } = req.params;

  try {
    const videoData = await VideoLink.findOne({ shortId });
    if (!videoData) return res.status(404).send('Video could not be found.');

    const count = await Visit.countDocuments(); // index.ejs için lazım

    res.render('index', {
      count,
      prefill: true, // video önizlemesini tetiklemek için flag
      videoData
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası.');
  }
});

// Admin panel ve diğer rotalar buraya gelir...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
