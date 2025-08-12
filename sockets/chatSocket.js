// sockets/chatSocket.js
const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");

// === Presencia ===
const AWAY_MS = 2 * 60 * 1000;
const userConnCount = new Map();
const presence = new Map();
const awayTimers = new Map();

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
      const {
        chatId,
        emisorId,
        texto,
        archivos = [],
        replyTo = null,
        forwardOf = null,
      } = payload || {};

      if (!chatId || !emisorId || (!texto && archivos.length === 0)) {
        return cb?.({ ok: false, error: "Payload inválido" });
      }

      // ===== Normaliza replyTo (si solo llega _id, rellena texto/autor) =====
      let replyDoc;
      if (replyTo) {
        let rTexto = replyTo.texto || replyTo.preview || "";
        let rAutor = replyTo.autor || null;

        if ((!rTexto || !rAutor) && replyTo._id) {
          try {
            const original = await Mensaje.findById(replyTo._id)
              .select("_id texto emisor")
              .populate("emisor", "_id nombre nickname");
            if (original) {
              if (!rTexto) rTexto = original.texto || "";
              if (!rAutor && original.emisor) {
                rAutor = {
                  _id: original.emisor._id,
                  nombre: original.emisor.nombre,
                  nickname: original.emisor.nickname,
                };
              }
            }
          } catch {}
        }

        replyDoc = {
          _id: replyTo._id || undefined,
          texto: rTexto || "",
          preview: replyTo.preview || rTexto || "",
          autor: rAutor || null,
        };
      }

      // ===== Normaliza forwardOf =====
      const forwardDoc = forwardOf ? { _id: forwardOf._id || forwardOf } : undefined;

      // Guardar mensaje con replyTo/forwardOf
      let msg = await Mensaje.create({
        chat: chatId,
        emisor: emisorId,
        texto,
        archivos,
        replyTo: replyDoc,
        forwardOf: forwardDoc,
      });

      await Chat.findByIdAndUpdate(chatId, {
        ultimoMensaje: texto || (archivos.length ? "📎 Archivo" : "Mensaje"),
        ultimoMensajeAt: new Date(),
      });

      // Populate + garantizar que replyTo viaje en la emisión
      msg = await msg.populate("emisor", "_id nombre nickname fotoPerfil");
      const toEmit = msg.toObject ? msg.toObject() : msg;
      if (!toEmit.replyTo && replyDoc) toEmit.replyTo = replyDoc;

      // Emitir a todos los participantes (emisor y receptor/es)
      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (!chat) return cb?.({ ok: false, error: "Chat no encontrado" });

      chat.participantes.forEach((u) => {
        io.to(`user:${u._id.toString()}`).emit("chat:newMessage", {
          chatId,
          mensaje: toEmit,
        });
      });

      cb?.({ ok: true, mensaje: toEmit });
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

  
  // === Editar mensaje (en vivo) ===
  socket.on("chat:editMessage", async ({ messageId, texto }, cb) => {
    try {
      const uid = socket.data?.usuarioId || socket.data?.userId || null;
      if (!uid) return cb?.({ ok: false, error: "No autenticado" });
      if (!messageId || typeof texto !== "string") {
        return cb?.({ ok: false, error: "Parámetros inválidos" });
      }
      let msg = await Mensaje.findById(messageId);
      if (!msg) return cb?.({ ok: false, error: "Mensaje no encontrado" });
      if (String(msg.emisor) !== String(uid)) {
        return cb?.({ ok: false, error: "Solo puedes editar tus propios mensajes" });
      }
      msg.texto = texto;
      msg.editedAt = new Date();
      await msg.save();
      msg = await msg.populate("emisor", "_id nombre nickname fotoPerfil");
      const chat = await Chat.findById(msg.chat).populate("participantes", "_id");
      if (chat) {
        chat.participantes.forEach((u) => {
          const room = `user:${u._id.toString()}`;
          io.to(room).emit("chat:messageEdited", { chatId: String(msg.chat), mensaje: msg });
        });
      }
      cb?.({ ok: true, mensaje: msg });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || "Error al editar" });
    }
  });

  // === Borrar mensaje (en vivo) ===
  socket.on("chat:deleteMessage", async ({ messageId }, cb) => {
    try {
      const uid = socket.data?.usuarioId || socket.data?.userId || null;
      if (!uid) return cb?.({ ok: false, error: "No autenticado" });
      if (!messageId) return cb?.({ ok: false, error: "messageId requerido" });

      const msg = await Mensaje.findById(messageId);
      if (!msg) return cb?.({ ok: false, error: "Mensaje no encontrado" });
      if (String(msg.emisor) != String(uid)) {
        return cb?.({ ok: false, error: "Solo puedes borrar tus propios mensajes" });
      }
      const chatId = String(msg.chat);
      await Mensaje.deleteOne({ _id: messageId });

      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (chat) {
        chat.participantes.forEach((u) => {
          const room = `user:${u._id.toString()}`;
          io.to(room).emit("chat:messageDeleted", { chatId, messageId: String(messageId) });
        });
      }

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || "Error al borrar" });
    }
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
