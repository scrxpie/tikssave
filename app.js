require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const https = require('https');
const sanitize = require('sanitize-filename');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { spawn } = require('child_process');
const axios = require('axios');
const Visit = require('./models/Visit');
const Download = require('./models/Download');
const VideoLink = require('./models/VideoLink'); // TikTok modeli
const InstagramVideoLink = require('./models/InstagramVideoLink'); // Instagram modeli
const { customAlphabet } = require('nanoid');
const Tiktok = require('@tobyg74/tiktok-api-dl');

const app = express();
const port = process.env.PORT || 3000;
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7);
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
    .catch(err => console.error('MongoDB connection error:', err));


// --- ROTLAR ---
app.get('/', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const visit = new Visit({ ip, userAgent: req.headers['user-agent'] });
    await visit.save();
    const count = await Visit.countDocuments();
    res.render('index', { count, videoData: null });
});
app.get('/discord', (req, res) => res.render('discord'));
app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/terms', (req, res) => res.render('terms'));
app.get('/rights', (req, res) => res.render('rights'));
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/dashboard' }),
    (req, res) => res.redirect('/dashboard')
);
app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.render('dashboard', { user: null, guilds: null });
    }
    const user = req.user;
    const guilds = user.guilds;
    const manageableGuilds = guilds.filter(guild => (guild.permissions & 0x20) === 0x20 || (guild.permissions & 0x8) === 0x8);
    res.render('dashboard', { user: user, guilds: manageableGuilds });
});

// --- API ROTLARI (Kendi Scraper'ınızla) ---

// TikTok İşleme Rotası
app.post('/api/tiktok-process', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, message: 'URL belirtilmedi.' });
    }

    try {
        const tiktokData = await Tiktok.Downloader(url, { version: 'v3' });

        console.log('NPM paketinden gelen ham veri:', tiktokData);

        if (tiktokData && tiktokData.status === 'success' && tiktokData.result) {
            const result = tiktokData.result;
            const formattedData = {
                id: result.id,
                author: {
                    unique_id: result.author?.unique_id || 'unknown',
                    nickname: result.author?.nickname || 'unknown',
                    avatar: result.author?.avatar || 'unknown'
                },
                title: result.title || '',
                cover: result.cover?.[0] || '',
                play: result.video_no_watermark || '',
                hdplay: result.video_no_watermark_hd || '',
                music: result.music || '',
                stats: {
                    play_count: result.stats?.play_count || 0,
                    digg_count: result.stats?.digg_count || 0,
                    comment_count: result.stats?.comment_count || 0,
                    share_count: result.stats?.share_count || 0
                }
            };

            const videoInfo = formattedData;
            let shortId;
            let exists;
            do {
                shortId = generateShortId();
                exists = await VideoLink.findOne({ shortId });
            } while (exists);

            const newVideoLink = new VideoLink({
                shortId,
                originalUrl: url,
                videoInfo: videoInfo,
            });

            await newVideoLink.save();
            return res.json({ success: true, shortId, videoInfo });

        } else {
            return res.status(500).json({ success: false, message: 'NPM paketinden veri alınamadı.' });
        }
    } catch (error) {
        console.error('NPM paketi hatası:', error.message);
        return res.status(500).json({ success: false, message: 'API hatası.' });
    }
});

// Instagram İşleme Rotası
app.post('/api/instagram-process', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ success: false, message: 'URL yok' });
    }

    try {
        const pythonProcess = spawn('python3', ['./scrapers/insta_scraper.py', url]);
        let rawData = '';
        let errorData = '';

        pythonProcess.stdout.on('data', (data) => rawData += data.toString());
        pythonProcess.stderr.on('data', (data) => errorData += data.toString());

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error('Python Hata Çıktısı:', errorData);
                return res.status(500).json({ success: false, message: 'Instagram verisi işlenirken bir hata oluştu.' });
            }
            
            try {
                const apiData = JSON.parse(rawData);
                if (!apiData.success) {
                    return res.status(400).
