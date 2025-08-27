const mongoose = require('mongoose');

const instagramLinkSchema = new mongoose.Schema({
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
  mediaInfo: {
    type: Object,
    default: null,
  }
});

module.exports = mongoose.model('InstagramLink', instagramLinkSchema);
