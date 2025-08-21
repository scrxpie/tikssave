const mongoose = require('mongoose');

// Instagram Video Şeması
const instagramVideoLinkSchema = new mongoose.Schema({
  // Sitemiz için oluşturulan benzersiz kısa kimlik (short ID)
  shortId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  // Orijinal Instagram video URL'si
  originalUrl: {
    type: String,
    required: true,
  },
  // Kaydın oluşturulma tarihi.
  // TTL (Time to Live) ile 7 gün sonra otomatik silinecek.
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '7d', 
  },
  // Python scraper'dan gelen tüm video bilgileri
  videoInfo: {
    type: Object,
    default: null,
  }
});

// Modeli dışa aktarma
module.exports = mongoose.model('InstagramVideoLink', instagramVideoLinkSchema);
