// routes/chatRoutes-1.js
const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");

const {
  ensurePrivado,
  listarChats,
  obtenerMensajes,
  eliminarParaMi,
  toggleFavorito,
  marcarFavorito,
  quitarFavorito,
  fijarMensaje,
  desfijarMensaje,
  obtenerPins,
  adminListarMensajes,
  adminEliminarChat,
  editarMensaje,
  eliminarMensaje,
} = require("../controllers/chatController");

// 🔒 Rate limiting simple en memoria (por proceso)
const rateLimit = ({ windowMs = 60_000, max = 10 } = {}) => {
  const hits = new Map(); // key -> { count, expires }
  return (req, res, next) => {
    const key = (req.ip || req.connection?.remoteAddress || "unknown") + "|" + (req.baseUrl + req.path);
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.expires < now) {
      hits.set(key, { count: 1, expires: now + windowMs });
      return next();
    }
    if (rec.count >= max) {
      const retryAfter = Math.ceil((rec.expires - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ error: "Demasiadas solicitudes, intenta más tarde." });
    }
    rec.count += 1;
    return next();
  };
};

// 🔒 Cabeceras de seguridad
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// 🔒 JSON para modificaciones
router.use(express.json({ limit: "1.5mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST","PUT","PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  next();
});

// Crear / obtener chat 1:1
router.post("/ensure-privado", verificarToken, rateLimit({ windowMs: 60_000, max: 20 }), ensurePrivado);

// Listado de chats del usuario autenticado
router.get("/", verificarToken, rateLimit({ windowMs: 60_000, max: 60 }), listarChats);

// Mensajes de un chat
router.get("/:chatId/mensajes", verificarToken, rateLimit({ windowMs: 60_000, max: 60 }), obtenerMensajes);

// Soft delete “para mí”
router.delete("/:chatId/me", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), eliminarParaMi);

// Favoritos (conversaciones)
router.patch("/:chatId/favorite", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), toggleFavorito);
router.post("/:chatId/favorite", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), marcarFavorito);
router.delete("/:chatId/favorite", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), quitarFavorito);

// Pins por usuario
router.get("/:chatId/pins", verificarToken, rateLimit({ windowMs: 60_000, max: 60 }), obtenerPins);
router.post("/messages/:messageId/pin", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), fijarMensaje);
router.delete("/messages/:messageId/pin", verificarToken, rateLimit({ windowMs: 60_000, max: 30 }), desfijarMensaje);

// === Mensajes: editar y borrar ===
router.patch("/messages/:messageId", verificarToken, rateLimit({ windowMs: 60_000, max: 20 }), editarMensaje);
router.delete("/messages/:messageId", verificarToken, rateLimit({ windowMs: 60_000, max: 20 }), eliminarMensaje);

// Admin
router.get("/admin/:chatId/messages", rateLimit({ windowMs: 60_000, max: 30 }), adminListarMensajes);
router.delete("/admin/:chatId", rateLimit({ windowMs: 60_000, max: 10 }), adminEliminarChat);

module.exports = router;
