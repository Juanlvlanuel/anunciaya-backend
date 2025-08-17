// sockets/chatSocket.js — ENFORCE bloqueos: envío y typing
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

// === Helper: comprueba si userId puede enviar al chat ===
async function canSendToChat(chatId, userId) {
  const chat = await Chat.findById(chatId).select("participantes blockedBy").lean();
  if (!chat) return { ok: false, reason: "Chat no encontrado" };

  const sender = String(userId);
  const participantes = (chat.participantes || []).map(String);
  const blockedBy = new Set((chat.blockedBy || []).map((x) => String(x)));

  if (!participantes.includes(sender))
    return { ok: false, reason: "No perteneces a este chat" };

  // Si YO bloqueé este chat, no puedo enviar
  if (blockedBy.has(sender))
    return { ok: false, reason: "Has bloqueado este chat" };

  // Si el OTRO bloqueó este chat, tampoco puedo enviarle
  const otroBloqueo = participantes.some((uid) => uid !== sender && blockedBy.has(uid));
  if (otroBloqueo)
    return { ok: false, reason: "El usuario te ha bloqueado" };

  return { ok: true, chat, blockedBy };
}

exports.registerChatSocket = (io, socket) => {
  // ====== Presencia
  socket.on("user:status:request", () => {
    const snapshot = {};
    for (const [uid, info] of presence.entries()) snapshot[uid] = info.status;
    socket.emit("user:status:snapshot", snapshot);
  });

  socket.on("join", ({ usuarioId }) => {
    if (!usuarioId) return;
    socket.data.usuarioId = String(usuarioId);
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

  // ====== Envío de mensajes (con enforcement de bloqueo)
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

      const sender = String(emisorId || socket.data?.usuarioId);
      if (!chatId || !sender || (!texto && archivos.length === 0)) {
        return cb?.({ ok: false, error: "Payload inválido" });
      }

      const check = await canSendToChat(chatId, sender);
      if (!check.ok) return cb?.({ ok: false, error: check.reason });

      // ===== replyTo normalizado
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
      const forwardDoc = forwardOf ? { _id: forwardOf._id || forwardOf } : undefined;

      // ===== Guardar mensaje
      let msg = await Mensaje.create({
        chat: chatId,
        emisor: sender,
        texto,
        archivos,
        replyTo: replyDoc,
        forwardOf: forwardDoc,
      });

      await Chat.findByIdAndUpdate(chatId, {
        ultimoMensaje: texto || (archivos.length ? "📎 Archivo" : "Mensaje"),
        ultimoMensajeAt: new Date(),
      });

      // Desocultar para destinatarios que lo tenían borrado "para mí"
      const recipients = (check.chat.participantes || [])
        .map(String)
        .filter((uid) => uid !== sender);
      if (recipients.length) {
        try {
          await Chat.updateOne(
            { _id: chatId },
            { $pull: { deletedFor: { $in: recipients } } }
          );
        } catch {}
      }

      // populate de emisor + asegurar replyTo viajando
      msg = await msg.populate("emisor", "_id nombre nickname fotoPerfil");
      const toEmit = msg.toObject ? msg.toObject() : msg;
      if (!toEmit.replyTo && replyDoc) toEmit.replyTo = replyDoc;

      // ===== Emitir SOLO a quienes no bloquearon (y al emisor)
      const blockedBy = check.blockedBy; // Set()
      const all = (check.chat.participantes || []).map(String);
      const targets = all.filter((uid) => !blockedBy.has(uid));

      for (const uid of targets) {
        io.to(`user:${uid}`).emit("chat:newMessage", { chatId, mensaje: toEmit });
      }

      return cb?.({ ok: true, mensaje: toEmit });
    } catch (e) {
      console.error("chat:send error", e);
      return cb?.({ ok: false, error: e?.message || "No se pudo enviar el mensaje" });
    }
  });

  // ====== Typing (filtrado por bloqueo)
  socket.on("chat:typing", async ({ chatId, usuarioId, typing }) => {
    try {
      const sender = String(usuarioId || socket.data?.usuarioId);
      if (!chatId || !sender) return;

      const check = await canSendToChat(chatId, sender);
      if (!check.ok) return; // si no puede ni enviar, tampoco typing

      const blockedBy = check.blockedBy; // Set()
      const all = (check.chat.participantes || []).map(String);
      const targets = all
        .filter((uid) => uid !== sender)          // no me reenvío a mí
        .filter((uid) => !blockedBy.has(uid));    // no se lo mando a quien bloqueó

      for (const uid of targets) {
        io.to(`user:${uid}`).emit("chat:typing", { chatId, usuarioId: sender, typing: !!typing });
      }
    } catch {}
  });

  // ====== Editar mensaje (sin cambios)
  socket.on("chat:editMessage", async ({ messageId, texto }, cb) => {
    try {
      const uid = socket.data?.usuarioId || null;
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
          io.to(`user:${String(u._id)}`).emit("chat:messageEdited", { chatId: String(msg.chat), mensaje: msg });
        });
      }
      cb?.({ ok: true, mensaje: msg });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || "Error al editar" });
    }
  });

  // ====== Borrar mensaje (sin cambios)
  socket.on("chat:deleteMessage", async ({ messageId }, cb) => {
    try {
      const uid = socket.data?.usuarioId || null;
      if (!uid) return cb?.({ ok: false, error: "No autenticado" });
      if (!messageId) return cb?.({ ok: false, error: "messageId requerido" });

      const msg = await Mensaje.findById(messageId);
      if (!msg) return cb?.({ ok: false, error: "Mensaje no encontrado" });
      if (String(msg.emisor) !== String(uid)) {
        return cb?.({ ok: false, error: "Solo puedes borrar tus propios mensajes" });
      }
      const chatId = String(msg.chat);
      await Mensaje.deleteOne({ _id: messageId });

      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (chat) {
        chat.participantes.forEach((u) => {
          io.to(`user:${String(u._id)}`).emit("chat:messageDeleted", { chatId, messageId: String(messageId) });
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
