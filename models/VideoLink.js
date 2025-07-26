const mongoose = require('mongoose');

const videoLinkSchema = new mongoose.Schema({
  shortId: { type: String, unique: true, required: true },
  play: String,
  hdplay: String,
  music: String,
  username: String,
  title: String,
  cover: String,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 } // 7 gün sonra otomatik silinsin
});

module.exports = mongoose.model('VideoLink', videoLinkSchema);
