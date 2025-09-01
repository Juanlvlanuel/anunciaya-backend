// sockets/chatSocket.js — versión sin logs molestos
const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function looksLikeImageName(name = "") { return IMG_EXT_RE.test(String(name)); }
function normalizeArchivo(a = {}) {
  const out = { ...a };
  const clean = (u) => (typeof u === "string" && u.startsWith("blob:") ? "" : u);

  out.url =
    clean(a.url) ||
    clean(a.fileUrl) ||
    clean(a.location) ||
    clean(a.src) ||
    clean(a.path) ||
    clean(a.ruta) ||
    (a.filename && a.filename.startsWith("/uploads/") ? a.filename : null) ||
    (a.filename && !a.filename.startsWith("/") ? `/uploads/${a.filename}` : null) ||
    "";

  out.thumbUrl =
    clean(a.thumbUrl) ||
    clean(a.thumbnail) ||
    (typeof out.url === "string" && out.url.includes("/uploads/")
      ? out.url.replace(/(\.[a-z0-9]+)$/i, "_sm.webp")
      : "");

  const mime = String(a.mimeType || a.contentType || a.type || "").toLowerCase();
  out.isImage = a.isImage === true || mime.startsWith("image/") || looksLikeImageName(a.name || a.filename || out.url);
  out.name = a.name || a.filename || a.originalName || "";
  return out;
}

// ===== Presencia =====
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

async function canSendToChat(chatId, userId) {
  const chat = await Chat.findById(chatId).select("participantes blockedBy").lean();
  if (!chat) return { ok: false, reason: "Chat no encontrado" };
  const sender = String(userId);
  const participantes = (chat.participantes || []).map(String);
  const blockedBy = new Set((chat.blockedBy || []).map((x) => String(x)));
  if (!participantes.includes(sender)) return { ok: false, reason: "No perteneces a este chat" };
  if (blockedBy.has(sender)) return { ok: false, reason: "Has bloqueado este chat" };
  const otroBloqueo = participantes.some((uid) => uid !== sender && blockedBy.has(uid));
  if (otroBloqueo) return { ok: false, reason: "El usuario te ha bloqueado" };
  return { ok: true, chat, blockedBy };
}

exports.registerChatSocket = (io, socket) => {
  // Snapshot de presencia
  socket.on("user:status:request", () => {
    const snapshot = {};
    for (const [uid, info] of presence.entries()) snapshot[uid] = info.status;
    socket.emit("user:status:snapshot", snapshot);
  });

  // === Unirse por usuario (alias compatibles)
  function joinUser(userId) {
    if (!userId) return;
    socket.data.usuarioId = String(userId);
    socket.join(`user:${userId}`);
    const count = (userConnCount.get(userId) || 0) + 1;
    userConnCount.set(userId, count);
    if (count === 1) broadcastStatus(io, userId, "online");
    scheduleAway(io, userId);
  }
  socket.on("join", ({ usuarioId }) => joinUser(usuarioId));
  socket.on("chat:join", ({ usuarioId }) => joinUser(usuarioId));
  socket.on("user:join", (userId) => joinUser(userId));

  socket.on("user:activity", () => {
    const userId = socket.data.usuarioId;
    if (!userId) return;
    broadcastStatus(io, userId, "online");
    scheduleAway(io, userId);
  });

  // === Unirse por chat
  function joinChatRoom(chatId) {
    const cid = String(chatId || "");
    if (!cid) return;
    socket.join(`chat:${cid}`);
  }
  socket.on("chat:room:join", (chatId) => joinChatRoom(chatId));
  socket.on("chat:joinRoom", (chatId) => joinChatRoom(chatId));

  // === Envío de mensajes
  socket.on("chat:send", async (payload, cb) => {
    try {
      const { chatId, emisorId, texto, archivos = [], replyTo = null, forwardOf = null } = payload || {};
      const sender = String(emisorId || socket.data?.usuarioId);
      if (!chatId || !sender || (!texto && archivos.length === 0)) return cb?.({ ok: false, error: "Payload inválido" });

      const check = await canSendToChat(chatId, sender);
      if (!check.ok) return cb?.({ ok: false, error: check.reason });

      const archivosNorm = Array.isArray(archivos) ? archivos.map(normalizeArchivo) : [];

      let replyDoc;
      if (replyTo) {
        let rTexto = replyTo.texto || replyTo.preview || "";
        let rAutor = replyTo.autor || null;
        if ((!rTexto || !rAutor) && replyTo._id) {
          try {
            const original = await Mensaje.findById(replyTo._id).select("_id texto emisor").populate("emisor", "_id nombre nickname");
            if (original) {
              if (!rTexto) rTexto = original.texto || "";
              if (!rAutor && original.emisor) rAutor = { _id: original.emisor._id, nombre: original.emisor.nombre, nickname: original.emisor.nickname };
            }
          } catch {}
        }
        replyDoc = { _id: replyTo._id || undefined, texto: rTexto || "", preview: replyTo.preview || rTexto || "", autor: rAutor || null };
      }
      const forwardDoc = forwardOf ? { _id: forwardOf._id || forwardOf } : undefined;

      let msg = await Mensaje.create({ chat: chatId, emisor: sender, texto, archivos: archivosNorm, replyTo: replyDoc, forwardOf: forwardDoc });
      await Chat.findByIdAndUpdate(chatId, { ultimoMensaje: texto || (archivosNorm.length ? "📎 Archivo" : "Mensaje"), ultimoMensajeAt: new Date() });

      const recipients = (check.chat.participantes || []).map(String).filter((uid) => uid !== sender);
      if (recipients.length) { try { await Chat.updateOne({ _id: chatId }, { $pull: { deletedFor: { $in: recipients } } }); } catch {} }

      msg = await msg.populate("emisor", "_id nombre nickname fotoPerfil");
      const toEmit = msg.toObject ? msg.toObject() : msg;
      if (!toEmit.replyTo && replyDoc) toEmit.replyTo = replyDoc;

      const blockedBy = check.blockedBy;
      const all = (check.chat.participantes || []).map(String);
      const targets = all.filter((uid) => uid !== sender).filter((uid) => !blockedBy.has(uid));

      // Emitir por usuario
      for (const uid of targets) io.to(`user:${uid}`).emit("chat:newMessage", { chatId, mensaje: toEmit });
      // Y por room del chat (compatibilidad)
      io.to(`chat:${String(chatId)}`).emit("chat:newMessage", { chatId: String(chatId), mensaje: toEmit });

      return cb?.({ ok: true, mensaje: toEmit });
    } catch (e) {
      return cb?.({ ok: false, error: e?.message || "No se pudo enviar el mensaje" });
    }
  });

  // typing
  socket.on("chat:typing", async ({ chatId, usuarioId, typing }) => {
    try {
      const sender = String(usuarioId || socket.data?.usuarioId);
      if (!chatId || !sender) return;
      const check = await canSendToChat(chatId, sender);
      if (!check.ok) return;
      const blockedBy = check.blockedBy;
      const all = (check.chat.participantes || []).map(String);
      const targets = all.filter((uid) => uid !== sender).filter((uid) => !blockedBy.has(uid));
      for (const uid of targets) io.to(`user:${uid}`).emit("chat:typing", { chatId, usuarioId: sender, typing: !!typing });
      io.to(`chat:${String(chatId)}`).emit("chat:typing", { chatId: String(chatId), usuarioId: sender, typing: !!typing });
    } catch {}
  });

  // editar
  socket.on("chat:editMessage", async ({ messageId, texto }, cb) => {
    try {
      const uid = socket.data?.usuarioId || null;
      if (!uid) return cb?.({ ok: false, error: "No autenticado" });
      if (!messageId || typeof texto !== "string") return cb?.({ ok: false, error: "Parámetros inválidos" });
      let msg = await Mensaje.findById(messageId);
      if (!msg) return cb?.({ ok: false, error: "Mensaje no encontrado" });
      if (String(msg.emisor) !== String(uid)) return cb?.({ ok: false, error: "Solo puedes editar tus propios mensajes" });
      msg.texto = texto; msg.editedAt = new Date(); await msg.save();
      msg = await msg.populate("emisor", "_id nombre nickname fotoPerfil");
      const chatId = String(msg.chat);
      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (chat) { chat.participantes.forEach((u) => io.to(`user:${String(u._id)}`).emit("chat:messageEdited", { chatId, mensaje: msg })); }
      io.to(`chat:${chatId}`).emit("chat:messageEdited", { chatId, mensaje: msg });
      cb?.({ ok: true, mensaje: msg });
    } catch (e) { cb?.({ ok: false, error: e?.message || "Error al editar" }); }
  });

  // borrar
  socket.on("chat:deleteMessage", async ({ messageId }, cb) => {
    try {
      const uid = socket.data?.usuarioId || null;
      if (!uid) return cb?.({ ok: false, error: "No autenticado" });
      if (!messageId) return cb?.({ ok: false, error: "messageId requerido" });
      const msg = await Mensaje.findById(messageId);
      if (!msg) return cb?.({ ok: false, error: "Mensaje no encontrado" });
      if (String(msg.emisor) !== String(uid)) return cb?.({ ok: false, error: "Solo puedes borrar tus propios mensajes" });
      const chatId = String(msg.chat);
      await Mensaje.deleteOne({ _id: messageId });
      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      if (chat) { chat.participantes.forEach((u) => io.to(`user:${String(u._id)}`).emit("chat:messageDeleted", { chatId, messageId: String(messageId) })); }
      io.to(`chat:${chatId}`).emit("chat:messageDeleted", { chatId, messageId: String(messageId) });
      cb?.({ ok: true });
    } catch (e) { cb?.({ ok: false, error: e?.message || "Error al borrar" }); }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.usuarioId; if (!userId) return;
    const count = Math.max(0, (userConnCount.get(userId) || 1) - 1);
    userConnCount.set(userId, count);
    if (count === 0) { clearTimeout(awayTimers.get(userId)); awayTimers.delete(userId); broadcastStatus(io, userId, "offline"); }
  });
};
