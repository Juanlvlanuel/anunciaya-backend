// controllers/chatController-1.js
// Añade normalización de archivos (url/thumbUrl/isImage) y endpoint enviarMensaje.
// Mantiene toda tu lógica actual y exports existentes.

const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");
const Usuario = require("../models/Usuario");
const cloudinary = require("../utils/cloudinary");
const { Types } = require("mongoose");

/* ========= Helpers ========= */
function getAuthUserId(req) {
  return String(
    req.usuario?._id || req.usuario?.id || req.usuario?.uid || req.usuarioId || ""
  );
}
function toIdStrings(arr = []) {
  return (arr || []).map((x) => String(x?._id || x?.id || x));
}
function asObjectId(id) {
  const s = String(id || "");
  return Types.ObjectId.isValid(s) ? new Types.ObjectId(s) : id;
}
function isValidObjectId(id) {
  const s = String(id || "");
  return Types.ObjectId.isValid(s);
}
function sanitizeTexto(texto) {
  if (typeof texto !== "string") return "";
  const t = texto.trim();
  return t.length > 4000 ? t.slice(0, 4000) : t;
}
/* ---- pins helpers (compat) ---- */
function getPinsArray(chat, uid) {
  try {
    const key = String(uid);
    const pb = chat?.pinsByUser;

    let raw;
    if (!pb) raw = [];
    else if (pb instanceof Map || typeof pb.get === "function") raw = pb.get(key);
    else if (typeof pb === "object") raw = pb[key];
    else raw = [];

    return Array.isArray(raw) ? raw.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}
function setPinsArray(chat, uid, arr) {
  const key = String(uid);
  if (chat.pinsByUser instanceof Map || typeof chat.pinsByUser?.set === "function") {
    if (!chat.pinsByUser) chat.pinsByUser = new Map();
    chat.pinsByUser.set(key, arr);
  } else {
    if (!chat.pinsByUser || typeof chat.pinsByUser !== "object") chat.pinsByUser = {};
    chat.pinsByUser[key] = arr;
  }
  chat.markModified?.("pinsByUser");
}

/* ========= Normalización de archivos ========= */
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function looksLikeImageName(name = "") {
  return IMG_EXT_RE.test(String(name));
}
function normalizeArchivo(a = {}) {
  const out = { ...a };

  // Fuente de URL (mejor esfuerzo)
  out.url =
    a.url ||
    a.fileUrl ||
    a.location ||
    a.src ||
    a.path ||
    a.ruta ||
    (a.filename && a.filename.startsWith("/uploads/") ? a.filename : null) ||
    (a.filename && !a.filename.startsWith("/") ? `/uploads/${a.filename}` : null) ||
    "";

  // Miniatura
  out.thumbUrl =
    a.thumbUrl ||
    a.thumbnail ||
    (typeof out.url === "string" && out.url.includes("/uploads/")
      ? out.url.replace(/(\.[a-z0-9]+)$/i, "_sm.webp")
      : "");

  // isImage por bandera/mime/extension
  const mime = String(a.mimeType || a.contentType || a.type || "").toLowerCase();
  out.isImage =
    a.isImage === true ||
    mime.startsWith("image/") ||
    looksLikeImageName(a.name || a.filename || out.url);

  // Nombre amigable
  out.name = a.name || a.filename || a.originalName || "";

  return out;
}

function normalizeMensajeArchivos(m) {
  if (!m) return m;
  const archivos = Array.isArray(m.archivos) ? m.archivos : [];
  m.archivos = archivos.map(normalizeArchivo);
  return m;
}

/* ===== Cloudinary helpers ===== */
function extractPublicIdFromUrl(u = "") {
  try {
    if (!u) return null;
    const s = String(u);
    const parts = s.split("/upload/");
    if (parts.length < 2) return null;
    let tail = parts[1];
    const vMatch = tail.match(/\/v\d+\//);
    if (vMatch) {
      tail = tail.slice(tail.indexOf(vMatch[0]) + vMatch[0].length);
    } else {
      const firstSlash = tail.indexOf("/");
      if (firstSlash >= 0) tail = tail.slice(firstSlash + 1);
    }
    tail = tail.replace(/\.[a-z0-9]+$/i, "");
    try { tail = decodeURIComponent(tail); } catch {}
    return tail;
  } catch {
    return null;
  }
}

async function destroyCloudinaryByArchivo(a = {}) {
  try {
    const pid = a.public_id || extractPublicIdFromUrl(a.url || a.fileUrl || a.src || a.location || a.ruta || a.path || a.thumbUrl || a.thumbnail || "");
    if (!pid) return { ok: false, reason: "no_public_id" };
    const res = await cloudinary.uploader.destroy(pid, { invalidate: true, resource_type: "image" });
    return { ok: true, result: res };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}



/* =========================
   Crear / obtener chat 1:1
========================= */
async function ensurePrivado(req, res) {
  try {
    let __created = false;
    const me = asObjectId(getAuthUserId(req));
    let { usuarioAId, usuarioBId, anuncioId } = req.body || {};

    const aValid = usuarioAId && Types.ObjectId.isValid(String(usuarioAId));
    const bValid = usuarioBId && Types.ObjectId.isValid(String(usuarioBId));
    if (!aValid && !bValid) {
      return res.status(400).json({ mensaje: "Falta usuario destino" });
    }

    usuarioAId = aValid ? asObjectId(usuarioAId) : null;
    usuarioBId = bValid ? asObjectId(usuarioBId) : null;

    let other = null;
    if (usuarioAId && String(usuarioAId) !== String(me)) other = usuarioAId;
    if (usuarioBId && String(usuarioBId) !== String(me)) other = usuarioBId;

    if (!other || String(other) === String(me)) {
      return res.status(400).json({ mensaje: "Falta usuario destino válido" });
    }

    const [yo, el] = await Promise.all([
      Usuario.findById(me).select("_id"),
      Usuario.findById(other).select("_id"),
    ]);
    if (!yo || !el) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    let chat = await Chat.findOne({
      tipo: "privado",
      participantes: { $all: [me, other], $size: 2 },
      ...(anuncioId ? { anuncioId: asObjectId(anuncioId) } : {}),
    }).populate("participantes", "_id nombre nickname correo fotoPerfil tipo");

    if (chat && Array.isArray(chat.deletedFor)) {
      const meStr = String(me);
      const hasMe = chat.deletedFor.some((x) => String(x) === meStr);
      if (hasMe) {
        chat.deletedFor = chat.deletedFor.filter((x) => String(x) !== meStr);
        await chat.save();
        chat = await Chat.findById(chat._id).populate(
          "participantes",
          "_id nombre nickname correo fotoPerfil tipo"
        );
      }
    }

    if (!chat) {
      __created = true;
      chat = await Chat.create({
        tipo: "privado",
        participantes: [me, other],
        anuncioId: anuncioId ? asObjectId(anuncioId) : null,
      });
      chat = await Chat.findById(chat._id).populate(
        "participantes",
        "_id nombre nickname correo fotoPerfil tipo"
      );
    }

    return res.status(__created ? 201 : 200).json(chat);
  } catch (e) {
    console.error("ensurePrivado:", e);
    return res.status(500).json({ mensaje: "Error al crear/obtener chat" });
  }
}

/* =========================
   Listar chats (favoritos arriba)
========================= */
async function listarChats(req, res) {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
    const uidObj = asObjectId(uid);

    const pipeline = [
      {
        $match: {
          participantes: uidObj,
          $or: [{ deletedFor: { $exists: false } }, { deletedFor: { $ne: uidObj } }],
        },
      },
      { $addFields: { _favoritesBySafe: { $ifNull: ["$favoritesBy", []] }, _blockedBySafe: { $ifNull: ["$blockedBy", []] } } },
      { $addFields: { isFavorite: { $in: [uidObj, "$_favoritesBySafe"] }, isBlocked: { $in: [uidObj, "$_blockedBySafe"] } } },
      { $sort: { isFavorite: -1, ultimoMensajeAt: -1, updatedAt: -1 } },
      { $limit: 200 },
      {
        $lookup: {
          from: "usuarios",
          localField: "participantes",
          foreignField: "_id",
          as: "participantes",
        },
      },
      {
        $project: {
          tipo: 1,
          participantes: {
            $map: {
              input: "$participantes",
              as: "p",
              in: {
                _id: "$$p._id",
                nombre: "$$p.nombre",
                nickname: "$$p.nickname",
                correo: "$$p.correo",
                fotoPerfil: "$$p.fotoPerfil",
                tipo: "$$p.tipo",
              },
            },
          },
          anuncioId: 1,
          favoritesBy: 1,
          blockedBy: 1,
          deletedFor: 1,
          pinsByUser: 1,
          ultimoMensaje: 1,
          ultimoMensajeAt: 1,
          createdAt: 1,
          updatedAt: 1,
          isFavorite: 1,
          isBlocked: 1,
        },
      },
    ];

    const chats = await Chat.aggregate(pipeline);
    return res.json(chats);
  } catch (e) {
    console.error("[listarChats] ERROR:", e?.message, e);
    return res.status(500).json({ mensaje: "Error al listar chats" });
  }
}

/* =========================
   Obtener mensajes
========================= */
async function obtenerMensajes(req, res) {
  try {
    const uid = String(req.usuario?._id || req.usuarioId || "");
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });
    if (!(chat.participantes || []).some((x) => String(x) === uid)) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const mensajes = await Mensaje.find({ chat: chatId }).sort({ createdAt: 1 }).lean();
    const normalizados = mensajes.map((m) => {
      if (!m.replyTo && m.reply) m.replyTo = m.reply;
      return normalizeMensajeArchivos(m);
    });

    return res.json(normalizados);
  } catch (e) {
    console.error("obtenerMensajes:", e);
    return res.status(500).json({ mensaje: "Error al obtener mensajes" });
  }
}

/* =========================
   Enviar mensaje (nuevo)
========================= */
async function enviarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { chatId } = req.params;
    if (!isValidObjectId(chatId)) return res.status(400).json({ mensaje: "chatId inválido" });

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });
    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const body = req.body || {};
    const texto = sanitizeTexto(body.texto);
    const archivosRaw = Array.isArray(body.archivos) ? body.archivos : [];

    const archivos = archivosRaw.map(normalizeArchivo);

    // Normaliza replyTo (autor como objeto; completa texto/autor desde mensaje original si falta)
    let replyDoc;
    if (body.replyTo) {
      let rTexto = body.replyTo.texto || body.replyTo.preview || "";
      let rAutor = body.replyTo.autor || null;
      if (rAutor && typeof rAutor !== "object") rAutor = { _id: String(rAutor) };
      if ((!rTexto || !rAutor) && body.replyTo._id) {
        try {
          const original = await Mensaje.findById(body.replyTo._id)
            .select("_id texto emisor")
            .populate("emisor", "_id nombre nickname");
          if (original) {
            if (!rTexto) rTexto = original.texto || "";
            if (!rAutor && original.emisor) {
              rAutor = { _id: original.emisor._id, nombre: original.emisor.nombre, nickname: original.emisor.nickname };
            }
          }
        } catch {}
      }
      replyDoc = { _id: body.replyTo._id || undefined, texto: rTexto || "", preview: body.replyTo.preview || rTexto || "", autor: rAutor || null };
    }

    const doc = await Mensaje.create({
      chat: asObjectId(chatId),
      emisor: asObjectId(uid),
      texto: texto || undefined,
      archivos,
      replyTo: replyDoc || undefined,
      forwardOf: body.forwardOf || undefined,
    });

    // Actualiza último mensaje en Chat (si tu modelo lo usa)
    try {
      await Chat.updateOne(
        { _id: chat._id },
        { $set: { ultimoMensaje: texto || (archivos.length ? "[archivo]" : ""), ultimoMensajeAt: new Date() } }
      );
    } catch {}

    const saved = await Mensaje.findById(doc._id).lean();
    return res.status(201).json(normalizeMensajeArchivos(saved));
  } catch (e) {
    console.error("enviarMensaje:", e);
    return res.status(500).json({ mensaje: "Error al enviar mensaje" });
  }
}

/* =========================
   Soft delete “para mí”
========================= */
async function eliminarParaMi(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const exists = (chat.deletedFor || []).some((x) => String(x) === String(uid));
    if (!exists) {
      chat.deletedFor = [...(chat.deletedFor || []), asObjectId(uid)];
      await chat.save();
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("eliminarParaMi:", e);
    return res.status(500).json({ mensaje: "Error al eliminar chat" });
  }
}

/* =========================
   Favoritos (toggle + compat)
========================= */
async function toggleFavorito(req, res) {
  try {
    const uid = getAuthUserId(req);
    const uidObj = asObjectId(uid);
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId).select("_id participantes favoritesBy");
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const isFav = (chat.favoritesBy || []).some((x) => String(x) === String(uid));
    if (isFav) {
      await Chat.updateOne({ _id: chatId }, { $pull: { favoritesBy: uidObj } });
    } else {
      await Chat.updateOne({ _id: chatId }, { $addToSet: { favoritesBy: uidObj } });
    }

    return res.json({ ok: true, favorito: !isFav });
  } catch (e) {
    console.error("toggleFavorito:", e);
    return res.status(500).json({ mensaje: "Error al alternar favorito" });
  }
}

async function marcarFavorito(req, res) {
  try {
    const uid = getAuthUserId(req);
    const uidObj = asObjectId(uid);
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $addToSet: { favoritesBy: uidObj } });
    return res.json({ ok: true, favorito: true });
  } catch (e) {
    console.error("marcarFavorito:", e);
    return res.status(500).json({ mensaje: "Error al marcar favorito" });
  }
}
async function quitarFavorito(req, res) {
  try {
    const uid = getAuthUserId(req);
    const uidObj = asObjectId(uid);
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $pull: { favoritesBy: uidObj } });
    return res.json({ ok: true, favorito: false });
  } catch (e) {
    console.error("quitarFavorito:", e);
    return res.status(500).json({ mensaje: "Error al quitar favorito" });
  }
}

/* =========================
   Pins por usuario
========================= */
async function fijarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ mensaje: "messageId inválido" });
    }

    const msg = await Mensaje.findById(messageId).select("_id chat");
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    const chat = await Chat.findById(msg.chat);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const curr = getPinsArray(chat, uid);
    if (curr.includes(String(messageId))) {
      return res.json({ ok: true, pins: curr });
    }
    const next = [String(messageId), ...curr].slice(0, 5);

    setPinsArray(chat, uid, next);
    await chat.save();

    return res.json({ ok: true, pins: next });
  } catch (e) {
    console.error("fijarMensaje:", e);
    return res.status(500).json({ mensaje: "Error al fijar mensaje" });
  }
}
async function desfijarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ mensaje: "messageId inválido" });
    }

    const msg = await Mensaje.findById(messageId).select("_id chat");
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    const chat = await Chat.findById(msg.chat);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const curr = getPinsArray(chat, uid);
    const next = curr.filter((id) => id !== String(messageId));

    setPinsArray(chat, uid, next);
    await chat.save();

    return res.json({ ok: true, pins: next });
  } catch (e) {
    console.error("desfijarMensaje:", e);
    return res.status(500).json({ mensaje: "Error al desfijar mensaje" });
  }
}
async function obtenerPins(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) {
      return res.status(400).json({ mensaje: "chatId inválido" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const ids = getPinsArray(chat, uid);
    const mensajes = ids.length
      ? await Mensaje.find({ _id: { $in: ids } }).sort({ createdAt: 1 })
      : [];
    return res.json(mensajes.map(normalizeMensajeArchivos));
  } catch (e) {
    console.error("obtenerPins:", e);
    return res.status(500).json({ mensaje: "Error al obtener pins" });
  }
}

/* =========================
   Mensajes: editar y eliminar
========================= */

async function editarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ mensaje: "messageId inválido" });
    }

    const eliminarImagen =
      String(req.body?.eliminarImagen || "").toLowerCase() === "true" ||
      req.body?.eliminarImagen === true;

    const texto = sanitizeTexto((req.body || {}).texto);

    const msg = await Mensaje.findById(messageId);
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    if (String(msg.emisor) !== String(uid)) {
      return res.status(403).json({ mensaje: "Solo puedes editar tus propios mensajes" });
    }

    // Debe llegar al menos una intención: texto, archivo o eliminar imagen
    if (!texto && !req.file && !eliminarImagen) {
      return res.status(400).json({ mensaje: "Texto inválido" });
    }

    if (texto) {
      msg.texto = texto;
    }

    if (eliminarImagen) {
      const archivos = Array.isArray(msg.archivos) ? msg.archivos : [];
      if (archivos.length) {
        try { await Promise.allSettled(archivos.map((a) => destroyCloudinaryByArchivo(a))); } catch {}
      }
      msg.archivos = [];
    }

    if (req.file) {
      const f = req.file || {};
      const archivo = normalizeArchivo({
        filename: f.filename,
        name: f.originalname,
        mimeType: f.mimetype,
      });
      msg.archivos = [archivo];
    }

    msg.editedAt = new Date();
    await msg.save();

    const out = normalizeMensajeArchivos(msg.toObject());
    return res.json({ ok: true, mensaje: out });
  } catch (e) {
    console.error("editarMensaje:", e);
    return res.status(500).json({ mensaje: "Error al editar mensaje" });
  }
}



async function eliminarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ mensaje: "messageId inválido" });
    }

    const msg = await Mensaje.findById(messageId);
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    if (String(msg.emisor) !== String(uid)) {
      return res.status(403).json({ mensaje: "Solo puedes borrar tus propios mensajes" });
    }

    // ✅ Al borrar el mensaje completo, elimina sus adjuntos en Cloudinary (múltiples)
    const archivos = Array.isArray(msg.archivos) ? msg.archivos : [];
    if (archivos.length) {
      try {
        await Promise.allSettled(archivos.map((a) => destroyCloudinaryByArchivo(a)));
      } catch {}
    }

    await Mensaje.deleteOne({ _id: messageId });

    return res.json({ ok: true });
  } catch (e) {
    console.error("eliminarMensaje:", e);
    return res.status(500).json({ mensaje: "Error al eliminar mensaje" });
  }
}





/* =========================
   BLOQUEAR / DESBLOQUEAR
========================= */
async function bloquearParaMi(req, res) {
  try {
    const uid = asObjectId(getAuthUserId(req));
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) return res.status(400).json({ mensaje: "chatId inválido" });
    const chat = await Chat.findById(chatId).select("_id participantes blockedBy");
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $addToSet: { blockedBy: uid } });
    return res.json({ ok: true, bloqueado: true });
  } catch (e) {
    console.error("bloquearParaMi:", e);
    return res.status(500).json({ mensaje: "Error al bloquear" });
  }
}
async function desbloquearParaMi(req, res) {
  try {
    const uid = asObjectId(getAuthUserId(req));
    const { chatId } = req.params;

    if (!isValidObjectId(chatId)) return res.status(400).json({ mensaje: "chatId inválido" });
    const chat = await Chat.findById(chatId).select("_id participantes blockedBy");
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $pull: { blockedBy: uid } });
    return res.json({ ok: true, bloqueado: false });
  } catch (e) {
    console.error("desbloquearParaMi:", e);
    return res.status(500).json({ mensaje: "Error al desbloquear" });
  }
}


async function setBackground(req, res) {
  try {
    const uid = String(req.usuario?._id || req.usuarioId || "");
    const { chatId } = req.params;
    const { backgroundUrl } = req.body || {};
    if (!chatId) return res.status(400).json({ mensaje: "chatId inválido" });

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });
    const participants = (chat.participantes || []).map((x) => String(x));
    if (!participants.includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    chat.backgroundUrl = String(backgroundUrl || "");
    await chat.save();

    return res.json({ ok: true, backgroundUrl: chat.backgroundUrl });
  } catch (e) {
    console.error("setBackground:", e);
    return res.status(500).json({ mensaje: "Error al actualizar fondo" });
  }
}

module.exports = {
  ensurePrivado,
  listarChats,
  obtenerMensajes,
  enviarMensaje,            // NUEVO
  eliminarParaMi,
  // favoritos
  toggleFavorito,
  marcarFavorito,
  quitarFavorito,
  // pins
  fijarMensaje,
  desfijarMensaje,
  obtenerPins,
  // mensajes
  editarMensaje,
  eliminarMensaje,
  // bloqueo
  bloquearParaMi,
  desbloquearParaMi,
  setBackground,
};
