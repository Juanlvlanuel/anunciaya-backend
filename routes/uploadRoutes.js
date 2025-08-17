const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const router = express.Router();

// Carpeta de uploads (asegura que exista)
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Almacenamiento en disco
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file")
      .replace(/\s+/g, "_")
      .replace(/[^\w.\-]/g, ""); // caracteres seguros
    cb(null, `${Date.now()}_${safe}`);
  },
});

// Tipos permitidos coherentes con el controlador (jpg/png/webp)
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// Filtro de archivo: NO lanzar error; marcar razón y rechazar suavemente
const fileFilter = (req, file, cb) => {
  if (ALLOWED.has(file.mimetype)) return cb(null, true);
  req.fileValidationError = "Tipo de archivo no permitido (usa JPG, PNG o WEBP)";
  return cb(null, false);
};

// Límite de tamaño (15 MB)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Controlador reforzado
const { handleUpload } = require("../controllers/uploadController");

// Seguridad básica de cabeceras
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function finalizeUpload(req, res, next, err) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: err.message } });
  }
  if (err) {
    return res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Tipo de archivo no permitido (usa JPG, PNG o WEBP)" } });
  }
  if (!req.file) {
    const code = req.fileValidationError ? 415 : 400;
    const message = req.fileValidationError || "Archivo requerido";
    return res.status(code).json({ error: { code: code === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST", message } });
  }
  return handleUpload(req, res, next);
}

// Alias 1: POST /api/upload (clave form-data: file)
router.post("/", (req, res, next) => {
  upload.single("file")(req, res, (err) => finalizeUpload(req, res, next, err));
});

// Alias 2: POST /api/upload/single (clave form-data: file) - se mantiene
router.post("/single", (req, res, next) => {
  upload.single("file")(req, res, (err) => finalizeUpload(req, res, next, err));
});

// 405 para métodos no permitidos
router.all(["/", "/single"], (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "Método no permitido" } });
  }
  return res.status(404).json({ error: { code: "NOT_FOUND", message: "No encontrado" } });
});

module.exports = router;
