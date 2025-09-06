require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);
const axios = require('axios');

const Visit = require('./models/Visit');
const VideoLink = require('./models/VideoLink');
const Download = require('./models/Download');

const app = express();
const port = process.env.PORT || 3000;

// --- Proxy listeleri (opsiyonel) ---
const INSTAGRAM_PROXIES = [process.env.INSTA_PROXY_URL];

// Helper: random proxy seç
function getRandomProxy(proxies) {
    if (!proxies || proxies.length === 0) throw new Error("Proxy listesi boş.");
    const index = Math.floor(Math.random() * proxies.length);
    return proxies[index];
}

// Instagram fetch via fxembed
async function fetchInstagramMediaFxEmbed(instaUrl) {
    try {
        const res = await axios.get(`https://api.fxinstagram.com/oembed?url=${encodeURIComponent(instaUrl)}`, {
            timeout: 15000
        });
        const data = res.data;
        if (!data) throw new Error("fxembed boş veri döndürdü");

        return {
            media_url: data.video_url || data.thumbnail_url,
            is_video: !!data.video_url,
            title: data.title || null,
            author_name: data.author_name || null,
            thumbnail: data.thumbnail_url || null
        };
    } catch (err) {
        console.error("fxembed fetch hatası:", err.message);
        throw new Error("fxembed API hatası");
    }
}

// Eski Instagram proxy (opsiyonel)
async function fetchInstagramMedia(url) {
    const proxy = getRandomProxy(INSTAGRAM_PROXIES);
    const headers = { 'x-source': 'bot' };
    const res = await axios.post(proxy, { url }, { headers, timeout: 30000 });
    return res.data;
}

// --- Express setup ---
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

// Discord OAuth2
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error(err));

// --- Routes ---
// Ana sayfa
app.get('/', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    await new Visit({ ip, userAgent: req.headers['user-agent'] }).save();
    const count = await Visit.countDocuments();
    res.render('index', { count, videoData: null });
});

// API: Instagram işlem (bot için)
app.post('/api/instagram-process', async (req, res) => {
    const { url, useFxEmbed } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL yok' });

    try {
        let mediaInfo;

        if (useFxEmbed) {
            mediaInfo = await fetchInstagramMediaFxEmbed(url);
        } else {
            mediaInfo = await fetchInstagramMedia(url);
        }

        let shortId, exists;
        do {
            shortId = nanoid();
            exists = await VideoLink.findOne({ shortId });
        } while (exists);

        const newVideoLink = new VideoLink({ shortId, originalUrl: url, videoInfo: mediaInfo });
        await newVideoLink.save();

        console.log(`✅ Yeni Instagram medyası kaydedildi: ${shortId}`);
        res.json({ success: true, shortId, mediaInfo });
    } catch (err) {
        console.error('Instagram API işleme hatası:', err.message);
        res.status(500).json({ success: false, message: 'Instagram fetch hatası veya limit aşıldı.' });
    }
});

// API: ShortId ile info çek
app.get('/api/info/:shortId', async (req, res) => {
    try {
        const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
        if (!videoLink || !videoLink.videoInfo)
            return res.status(404).json({ success: false, message: 'Video bulunamadı.' });
        res.json({ success: true, videoInfo: videoLink.videoInfo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});

// ShortId ile redirect / proxy download
app.get('/:shortId', async (req, res) => {
    try {
        const videoLink = await VideoLink.findOne({ shortId: req.params.shortId });
        if (!videoLink) return res.status(404).send('Video bulunamadı');

        let videoData = videoLink.videoInfo;
        const videoUrl = videoData.media_url;

        if (!videoUrl) return res.status(404).send('Video URL yok');

        const userAgent = (req.headers['user-agent'] || '').toLowerCase();
        const isDiscordOrTelegram = userAgent.includes('discordbot') || userAgent.includes('telegrambot');
        const acceptsVideo = (req.headers['accept'] || '').includes('video/mp4');

        if (isDiscordOrTelegram || acceptsVideo) {
            return res.redirect(307, videoUrl);
        }

        res.render('index', { videoData });
    } catch (err) {
        console.error(err);
        res.status(500).send('Sunucu hatası');
    }
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
