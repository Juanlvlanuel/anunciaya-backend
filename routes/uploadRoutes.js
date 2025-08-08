const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const { handleUpload } = require("../controllers/uploadController");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || "bin";
    const safe = (file.originalname || "file").replace(/[^a-zA-Z0-9-_.]/g, "_");
    cb(null, `${Date.now()}_${safe}.${ext}`);
  },
});

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED.has(file.mimetype) || file.mimetype.startsWith("image/")) {
    return cb(null, true);
  }
  cb(new Error("Tipo de archivo no permitido. Solo imágenes"));
};

// ⬆️ sube límite a 15MB para evitar rechazos innecesarios
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post("/single", upload.single("file"), handleUpload);

module.exports = router;
