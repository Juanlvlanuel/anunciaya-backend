// utils/cloudinary.js (CommonJS)
const dotenv = require("dotenv");
dotenv.config();
const cloudinary = require("cloudinary").v2;

const required = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
for (const k of required) {
  if (!process.env[k]) {
    console.warn(`[Cloudinary] Falta variable de entorno: ${k}`);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

module.exports = cloudinary;
