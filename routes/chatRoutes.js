const express = require("express");
const router = express.Router();
const { ensureChatPrivado, listarChats, obtenerMensajes, marcarLeidos } = require("../controllers/chatController");

router.post("/ensure-privado", ensureChatPrivado);
router.get("/:usuarioId", listarChats);
router.get("/mensajes/:chatId", obtenerMensajes);
router.post("/mensajes/:chatId/leidos", marcarLeidos);

module.exports = router;
