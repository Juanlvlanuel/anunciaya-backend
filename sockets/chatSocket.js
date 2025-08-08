// sockets/chatSocket.js
const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");

// === Presencia en tiempo real ===
const AWAY_MS = 2 * 60 * 1000; // 2 minutos
const userConnCount = new Map();   // userId -> nº de sockets conectados
const presence = new Map();        // userId -> { status: 'online'|'away'|'offline', lastSeen: Date }
const awayTimers = new Map();      // userId -> Timeout

function broadcastStatus(io, userId, status) {
  presence.set(userId, { status, lastSeen: new Date() });
  io.emit("user:status", { userId, status, at: Date.now() });
}

function scheduleAway(io, userId) {
  clearTimeout(awayTimers.get(userId));
  const t = setTimeout(() => {
    const count = userConnCount.get(userId) || 0;
    if (count > 0) broadcastStatus(io, userId, "away");
  }, AWAY_MS);
  awayTimers.set(userId, t);
}

exports.registerChatSocket = (io, socket) => {
  socket.on("user:status:request", () => {
    const snapshot = {};
    for (const [uid, info] of presence.entries()) snapshot[uid] = info.status;
    socket.emit("user:status:snapshot", snapshot);
  });

  socket.on("join", ({ usuarioId }) => {
    if (!usuarioId) return;
    socket.data.usuarioId = usuarioId;
    socket.join(`user:${usuarioId}`);

    const count = (userConnCount.get(usuarioId) || 0) + 1;
    userConnCount.set(usuarioId, count);

    if (count === 1) broadcastStatus(io, usuarioId, "online");
    scheduleAway(io, usuarioId);
  });

  socket.on("user:activity", () => {
    const userId = socket.data.usuarioId;
    if (!userId) return;
    broadcastStatus(io, userId, "online");
    scheduleAway(io, userId);
  });

  // --- Mensajería ---
  socket.on("chat:send", async (payload, cb) => {
    try {
      const { chatId, emisorId, texto, archivos = [] } = payload || {};
      if (!chatId || !emisorId || (!texto && archivos.length === 0)) {
        return cb?.({ ok: false, error: "Payload inválido" });
      }

      const msg = await Mensaje.create({ chat: chatId, emisor: emisorId, texto, archivos });
      await Chat.findByIdAndUpdate(chatId, {
        ultimoMensaje: texto || (archivos.length ? "📎 Archivo" : ""),
        ultimoMensajeAt: new Date(),
      });

      const populated = await msg
        .populate("emisor", "_id nombre nickname fotoPerfil")
        .then(m => m);

      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (!chat) return cb?.({ ok: false, error: "Chat no encontrado" });

      chat.participantes.forEach((u) => {
        io.to(`user:${u._id.toString()}`).emit("chat:newMessage", {
          chatId,
          mensaje: populated,
        });
      });

      cb?.({ ok: true, mensaje: populated });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("chat:typing", async ({ chatId, usuarioId, typing }) => {
    try {
      if (!chatId || !usuarioId) return;
      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (!chat) return;

      chat.participantes.forEach((u) => {
        io.to(`user:${u._id.toString()}`).emit("chat:typing", {
          chatId,
          usuarioId,
          typing: !!typing,
        });
      });
    } catch {}
  });

  socket.on("disconnect", () => {
    const userId = socket.data.usuarioId;
    if (!userId) return;

    const count = Math.max(0, (userConnCount.get(userId) || 1) - 1);
    userConnCount.set(userId, count);

    if (count === 0) {
      clearTimeout(awayTimers.get(userId));
      awayTimers.delete(userId);
      broadcastStatus(io, userId, "offline");
    }
  });
};
