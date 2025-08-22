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

// Ana sayfa
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


// --- YENİ VE GÜNCELLENMİŞ API ROTLARI ---

// Bu rota, discord botundan gelen isteği işleyecek ve bilgileri veritabanına kaydedecek.
// app.js dosyanızda
// --- /api/tiktok-process rotası ---
app.post('/api/tiktok-process', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

    try {
        // Önce TikWM dene
        let videoInfo;
        try {
            const tikwmRes = await axios.post('https://www.tikwm.com/api/', { url });
            const tikwmData = tikwmRes.data;
            if (tikwmData.code === 0 && tikwmData.data) {
                videoInfo = tikwmData.data;
                console.log('TikWM success: Yeni video kaydedildi:', videoInfo.id);
            } else {
                console.warn('TikWM başarısız:', tikwmData.msg);
                throw new Error('TikWM failed');
            }
        } catch (tikwmErr) {
            console.warn('TikWM başarısız:', tikwmErr.message);
            console.log('RapidAPI fallback çalışıyor...');

            // RapidAPI ile fallback
            const rapidRes = await axios.get('https://tiktok-downloader-api.p.rapidapi.com/video', {
                params: { url },
                headers: {
                    'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'tiktok-downloader-api.p.rapidapi.com'
                }
            });
            const rapidData = rapidRes.data;

            if (!rapidData || !rapidData.video) {
                return res.status(404).json({ success: false, message: 'RapidAPI ile video alınamadı.' });
            }

            // RapidAPI datasını TikWM formatına uyarlayalım
            videoInfo = {
                id: rapidData.id || generateShortId(),
                author: rapidData.author || { unique_id: rapidData.username || 'unknown', nickname: rapidData.username || 'unknown', avatar: rapidData.avatar },
                title: rapidData.title,
                cover: rapidData.cover,
                play: rapidData.video || rapidData.play,
                hdplay: rapidData.video || rapidData.play,
                music: rapidData.music,
                play_count: rapidData.play_count,
                digg_count: rapidData.likes,
                comment_count: rapidData.comments,
                share_count: rapidData.shares,
                create_time: rapidData.create_time
            };

            console.log('RapidAPI success: Yeni video kaydedildi:', videoInfo.id);
        }

        // ShortId üret ve kaydet
        let shortId, exists;
        do {
            shortId = generateShortId();
            exists = await VideoLink.findOne({ shortId });
        } while (exists);

        const newVideoLink = new VideoLink({
            shortId,
            originalUrl: url,
            videoInfo
        });
        await newVideoLink.save();

        res.json({ success: true, shortId, videoInfo });

    } catch (err) {
        console.error('API işleme hatası:', err);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});


// Bu rota, Discord botunun shortId ile video bilgilerini çekmesini sağlar.
app.get('/api/info/:shortId', async (req, res) => {
  const { shortId } = req.params;

  try {
    const videoLink = await VideoLink.findOne({ shortId });

    if (!videoLink) {
      return res.status(404).json({ success: false, message: 'Video bulunamadı.' });
    }

    if (!videoLink.videoInfo) {
      return res.status(404).json({ success: false, message: 'Video bilgileri eksik.' });
    }

    res.json({ success: true, videoInfo: videoLink.videoInfo });

  } catch (err) {
    console.error('API bilgi çekme hatası:', err);
    res.status(500).json({ success: false, message: 'Sunucu hatası.' });
  }
});

// Mevcut /get-links rotasını kaldırın veya güncelleyin
// (Discord botunuz artık bunu kullanmayacağı için)
app.post('/get-links', async (req, res) => {
  // Bu rotayı isterseniz kaldırabilir veya diğer kullanımlar için tutabilirsiniz.
  // Şu an için Discord botunuz bu rotayı kullanmayacak.
  // Geriye dönük uyumluluk için burada bırakılabilir.
});


// In your `app.js` server file

// Find the existing '/proxy-download' route
app.get('/proxy-download', async (req, res) => {
  const { url, username, type, shortId } = req.query; // Add 'shortId' to the destructured query

  // Check if a shortId was provided
  let videoUrl = url;
  if (shortId) {
    try {
      const videoLink = await VideoLink.findOne({ shortId });
      if (videoLink && videoLink.videoInfo) {
        // Use the URL from your database
        videoUrl = videoLink.videoInfo.hdplay || videoLink.videoInfo.play;
        // You can also get the username from the database
        const videoUsername = videoLink.videoInfo.author?.unique_id || 'unknown';
        
        // Optional: Update username and type for filename from DB
        // (if you passed them to the DB originally)
        // If not, you might need to find a way to get them from the original request
        
      } else {
        return res.status(404).send('Video not found or info is missing.');
      }
    } catch (dbErr) {
      console.error('Database lookup error:', dbErr);
      return res.status(500).send('Database error.');
    }
  }

  // If there's no URL, return an error
  if (!videoUrl) {
    return res.status(400).send('Video link is missing.');
  }

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  await new Download({ url: videoUrl, ip }).save();
  const extension = (type === 'music') ? 'mp3' : 'mp4';
  const safeUsername = sanitize((username || 'unknown').replace(/[\s\W]+/g, '_')).substring(0, 30);
  const filename = `tikssave_${safeUsername}_${Date.now()}.${extension}`;
  console.log('Filename:', filename);

  https.get(videoUrl, fileRes => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fileRes.pipe(res);
  }).on('error', err => {
    console.error(err);
    res.status(500).send('Download error.');
  });
});


app.post('/tiktok', async (req, res) => {
  // Bu rotayı /api/tiktok-process rotası ile değiştirdim. 
  // Eski botlar hala bu rotayı kullanıyorsa, uyumluluk için bu rotayı da güncelleyebilirsiniz.
  // Veya yukarıdaki yeni rotaya yönlendirebilirsiniz.
});


app.get('/:shortId', async (req, res) => {
  const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
  if (!videoLink) {
    return res.status(404).send('Video bulunamadı');
  }

  // Eğer veritabanında video bilgileri zaten varsa, TikWM'e gitmeye gerek yok.
  let videoData;
  if (videoLink.videoInfo) {
      videoData = videoLink.videoInfo;
  } else {
      // Eğer veritabanında bilgi yoksa, TikWM'den çek ve kaydet (opsiyonel)
      try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(videoLink.originalUrl)}`);
        const data = await response.json();
        if (!data || data.code !== 0) {
          return res.status(404).send('Video bilgisi alınamadı.');
        }
        videoData = {
          play: data.data.play,
          hdplay: data.data.hdplay,
          music: data.data.music,
          username: data.data.author?.unique_id || 'unknown',
          title: data.data.title,
          cover: data.data.cover
        };
        // Veritabanını güncelle
        videoLink.videoInfo = data.data;
        await videoLink.save();
      } catch (err) {
        console.error(err);
        return res.status(500).send('Sunucu hatası.');
      }
  }

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

