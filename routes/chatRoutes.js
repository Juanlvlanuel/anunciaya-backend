// routes/chatRoutes-1.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");

const {
  ensurePrivado,
  listarChats,
  obtenerMensajes,
  enviarMensaje,
  eliminarParaMi,
  toggleFavorito,
  marcarFavorito,
  quitarFavorito,
  fijarMensaje,
  desfijarMensaje,
  obtenerPins,
  editarMensaje,
  eliminarMensaje,
  bloquearParaMi,
  desbloquearParaMi,
  setBackground,
} = require("../controllers/chatController");

// -------- Multer (disco) para edición con imagen --------
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "file").replace(/\s+/g, "_").replace(/[^\w.\-]/g, "");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) return cb(null, true);
    req.fileValidationError = "Tipo de archivo no permitido (JPG, PNG, WEBP, GIF)";
    return cb(null, false);
  },
});

// Hardening headers
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

router.use(express.json({ limit: "1.5mb" }));

// Privado
router.post("/ensure-privado", verificarToken, ensurePrivado);
router.post("/privado", verificarToken, ensurePrivado);

// Chats
router.get("/", verificarToken, listarChats);

// Mensajes
router.get("/:chatId/mensajes", verificarToken, obtenerMensajes);
router.post("/:chatId/mensajes", verificarToken, enviarMensaje);

// Fondo por chat (persistente)
router.patch("/:chatId/background", verificarToken, setBackground);

// Soft delete
router.delete("/:chatId/me", verificarToken, eliminarParaMi);

// Favoritos
router.patch("/:chatId/favorite", verificarToken, toggleFavorito);
router.post("/:chatId/favorite", verificarToken, marcarFavorito);
router.delete("/:chatId/favorite", verificarToken, quitarFavorito);

// Pins
router.get("/:chatId/pins", verificarToken, obtenerPins);
router.post("/messages/:messageId/pin", verificarToken, fijarMensaje);
router.delete("/messages/:messageId/pin", verificarToken, desfijarMensaje);

// Mensajes editar/borrar
// 👉 Soporta multipart/form-data: campo 'file' opcional
router.patch(
  "/messages/:messageId",
  verificarToken,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ mensaje: err.message });
      // Si file es inválido por tipo, multer no setea req.file; guardamos razón
      if (!req.file && req.fileValidationError) {
        return res.status(415).json({ mensaje: req.fileValidationError });
      }
      return next();
    });
  },
  editarMensaje
);
router.delete("/messages/:messageId", verificarToken, eliminarMensaje);

// Bloqueo
router.post("/:chatId/block", verificarToken, bloquearParaMi);
router.delete("/:chatId/block", verificarToken, desbloquearParaMi);

module.exports = router;
