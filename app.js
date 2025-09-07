require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const Visit = require('./models/Visit');
const VideoLink = require('./models/VideoLink');
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);
const axios = require('axios');

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
    .then(() => console.log('MongoDB connected'))
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

// --- Twitter (Fixupx) ---
app.post('/api/twitter-process', async (req, res) => {
    const { url: tweetUrl } = req.body;
    if (!tweetUrl) return res.status(400).json({ success: false, message: 'URL yok' });

    try {
        const regex = /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/;
        const match = tweetUrl.match(regex);
        if (!match) return res.status(400).json({ success: false, message: 'Geçersiz Twitter/X URL' });

        const username = match[1];
        const statusId = match[2];
        const fixupUrl = `https://d.fixupx.com/${username}/status/${statusId}.mp4`;

        let shortId, exists;
        do {
            shortId = nanoid();
            exists = await VideoLink.findOne({ shortId });
        } while (exists);

        const newVideoLink = new VideoLink({
            shortId,
            originalUrl: tweetUrl,
            videoInfo: { media_url: fixupUrl }
        });

        await newVideoLink.save();

        res.json({
            success: true,
            shortId,
            mediaInfo: { media_url: fixupUrl },
            link: `${process.env.SITE_URL}/${shortId}`
        });

    } catch {
        res.status(500).json({ success: false, message: 'Twitter işleme hatası' });
    }
});
// --- Twitter Direct Download (Video veya Foto) ---
app.get('/twitter-download/:statusId', async (req, res) => {
    try {
        const statusId = req.params.statusId;
        if (!statusId) return res.status(400).send('Tweet ID yok');

        // Varsayılan video URL (fixupx video)
        const fixupVideoUrl = `https://d.fixupx.com/i/status/${statusId}.mp4`;
        const fixupPhotoUrl = `https://d.fixupx.com/i/status/${statusId}.jpg`;

        // Önce video var mı diye kontrol et
        const headCheck = await axios.head(fixupVideoUrl).catch(() => null);

        if (headCheck && headCheck.status === 200) {
            // Video bulundu → mp4 yönlendir
            return res.redirect(307, fixupVideoUrl);
        }

        // Video yoksa fotoğrafı dene
        const imgCheck = await axios.head(fixupPhotoUrl).catch(() => null);
        if (imgCheck && imgCheck.status === 200) {
            return res.redirect(307, fixupPhotoUrl);
        }

        return res.status(404).send('Tweet medyası bulunamadı');
    } catch (err) {
        console.error('Twitter download error:', err.message);
        res.status(500).send('Sunucu hatası');
    }
});
// --- Proxy Download (⬇️ butonu için) ---
app.get('/proxy-download', async (req, res) => {
    try {
        const { shortId } = req.query;
        if (!shortId) return res.status(400).json({ success: false, message: 'shortId missing' });

        const video = await VideoLink.findOne({ shortId });
        if (!video || !video.videoInfo?.media_url) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        return res.redirect(video.videoInfo.media_url);
    } catch (err) {
        console.error('Proxy download error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ShortId redirect
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
                const freshData = await fetchTikTokVideoFromProxy(videoLink.originalUrl);
                videoData = freshData;
                videoLink.videoInfo = freshData;
            }
            await videoLink.save();
        } catch (err) {
            console.error('Yeniden fetch hatası:', err.message);
        }

        if (!videoData) return res.status(404).send('Video bilgisi alınamadı');

        const userAgent = (req.headers['user-agent'] || '').toLowerCase();
        const isDiscordOrTelegram = userAgent.includes('discordbot') || userAgent.includes('telegrambot');
        const acceptsVideo = (req.headers['accept'] || '').includes('video/mp4');

        if (isDiscordOrTelegram || acceptsVideo) {
            const redirectUrl = isTwitter ? videoData.media_url : videoData.hdplay || videoData.play || videoData.media_url;
            if (redirectUrl) return res.redirect(307, redirectUrl);
        }

        res.render('index', { videoData });

    } catch (err) {
        console.error(err);
        res.status(500).send('Sunucu hatası');
    }
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
