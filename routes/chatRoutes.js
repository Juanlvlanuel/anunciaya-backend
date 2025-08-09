const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");

const {
  ensurePrivado,
  listarChats,
  obtenerMensajes,
  eliminarParaMi,
  toggleFavorito,   // <-- nuevo
  marcarFavorito,
  quitarFavorito,
  fijarMensaje,
  desfijarMensaje,
  obtenerPins,
  adminListarMensajes,
  adminEliminarChat,
} = require("../controllers/chatController");

// Crear / obtener chat 1:1
router.post("/ensure-privado", verificarToken, ensurePrivado);

// Listado de chats del usuario autenticado
router.get("/", verificarToken, listarChats);

// Mensajes de un chat
router.get("/:chatId/mensajes", verificarToken, obtenerMensajes);

// Soft delete “para mí”
router.delete("/:chatId/me", verificarToken, eliminarParaMi);

// Favoritos (conversaciones)
router.patch("/:chatId/favorite", verificarToken, toggleFavorito); // <-- nuevo toggle
router.post("/:chatId/favorite", verificarToken, marcarFavorito);  // legacy
router.delete("/:chatId/favorite", verificarToken, quitarFavorito); // legacy

// Pins (por usuario)
router.get("/:chatId/pins", verificarToken, obtenerPins);
router.post("/messages/:messageId/pin", verificarToken, fijarMensaje);
router.delete("/messages/:messageId/pin", verificarToken, desfijarMensaje);

// Admin
router.get("/admin/:chatId/messages", adminListarMensajes);
router.delete("/admin/:chatId", adminEliminarChat);

module.exports = router;
