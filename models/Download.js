const mongoose = require('mongoose');

const DownloadSchema = new mongoose.Schema({
  url: String,
  ip: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Download', DownloadSchema);
