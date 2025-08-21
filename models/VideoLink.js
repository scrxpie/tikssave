// models/VideoLink.js

const mongoose = require('mongoose');

const videoLinkSchema = new mongoose.Schema({
  shortId: {
    type: String,
    required: true,
    unique: true,
  },
  originalUrl: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Yeni eklenen alan
  videoInfo: {
    type: Object,
    default: null,
  }
});

module.exports = mongoose.model('VideoLink', videoLinkSchema);
