// utils/uploadToBunny.js
const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_UPLOAD_ENDPOINT = process.env.BUNNY_UPLOAD_ENDPOINT;

async function uploadToBunny(filePath, fileName) {
  const url = `${BUNNY_UPLOAD_ENDPOINT}/${BUNNY_STORAGE_ZONE}/${fileName}`;
  const fileStream = fs.readFileSync(filePath);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'AccessKey': BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream'
    },
    body: fileStream
  });

  if (!response.ok) {
    throw new Error(`Yükleme başarısız oldu: ${response.statusText}`);
  }

  return `${process.env.BUNNY_STORAGE_URL}/${fileName}`;
}

module.exports = uploadToBunny;
