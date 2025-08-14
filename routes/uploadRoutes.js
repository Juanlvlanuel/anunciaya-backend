// routes/uploadRoutes-fixed.js
// Ruta de subida endurecida: usa el controlador reforzado, bloquea tipos no permitidos
// y devuelve 400/415 claros (evita 500).
// Copia este archivo como routes/uploadRoutes.js en tu proyecto.

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
  req.fileValidationError =
    "Tipo de archivo no permitido (usa JPG, PNG o WEBP)";
  return cb(null, false);
};

// Límite de tamaño (15 MB)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Controlador reforzado (el que te pasé)
const { handleUpload } = require("../controllers/uploadController");

// Endpoint: POST /api/upload/single
router.post("/single", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    // Errores de Multer (p. ej., límite de tamaño)
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    // Otros errores del middleware
    if (err) {
      return res
        .status(415)
        .json({ error: "Tipo de archivo no permitido (usa JPG, PNG o WEBP)" });
    }
    // Rechazo del fileFilter o falta de archivo
    if (!req.file) {
      const msg = req.fileValidationError || "Archivo requerido";
      const code = req.fileValidationError ? 415 : 400;
      return res.status(code).json({ error: msg });
    }
    // OK: pasa al controlador
    return handleUpload(req, res, next);
  });
});

module.exports = router;
