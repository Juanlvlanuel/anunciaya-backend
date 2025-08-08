// controllers/chatController.js
const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");
const Usuario = require("../models/Usuario");

exports.ensureChatPrivado = async (req, res) => {
  try {
    const { usuarioAId, usuarioBId, anuncioId } = req.body;
    if (!usuarioAId || !usuarioBId) return res.status(400).json({ error: "Faltan usuarios" });

    const [a, b] = await Promise.all([Usuario.findById(usuarioAId), Usuario.findById(usuarioBId)]);
    if (!a || !b) return res.status(404).json({ error: "Usuario no encontrado" });

    let chat = await Chat.findOne({
      participantes: { $all: [usuarioAId, usuarioBId], $size: 2 },
      tipo: "privado",
      ...(anuncioId ? { anuncioId } : {}),
    });
    if (!chat) chat = await Chat.create({ participantes: [usuarioAId, usuarioBId], anuncioId });

    res.json(chat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.listarChats = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const chats = await Chat.find({ participantes: usuarioId })
      .sort({ updatedAt: -1 })
      .populate("participantes", "nombre avatarUrl");
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.obtenerMensajes = async (req, res) => {
  try {
    const { chatId } = req.params;
    const mensajes = await Mensaje.find({ chat: chatId })
      .sort({ createdAt: 1 })
      .populate("emisor", "nombre avatarUrl");
    res.json(mensajes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.marcarLeidos = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { usuarioId } = req.body;
    await Mensaje.updateMany({ chat: chatId, leidoPor: { $ne: usuarioId } }, { $push: { leidoPor: usuarioId } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
