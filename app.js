require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fetch = require('node-fetch');
const Visit = require('./models/Visit');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Ana Sayfa: Sayaç + Form
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
  await visit.save();
  const count = await Visit.countDocuments();
  res.render('index', { count });
});

// Video İndirme İşlemi
app.post('/download', async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (!data || data.code !== 0) {
      return res.render('result', { error: 'Video indirilemedi.', video: null });
    }
    res.render('result', { video: data.data, error: null });
  } catch (err) {
    console.error(err);
    res.render('result', { error: 'Sunucu hatası.', video: null });
  }
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
