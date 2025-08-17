// controllers/chatController.js — PATCH Bloquear/Desbloquear + isBlocked + sort por ultimoMensajeAt
const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");
const Usuario = require("../models/Usuario");
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
  // Limita tamaño para evitar payloads enormes en edición
  return t.length > 4000 ? t.slice(0, 4000) : t;
}

/* ---- helpers específicos de pins (soporta Map, objeto o nada) ---- */
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

/* =========================
   Crear / obtener chat 1:1
========================= */
async function ensurePrivado(req, res) {
  try {
    let __created = false;
    const me = asObjectId(getAuthUserId(req));
    let { usuarioAId, usuarioBId, anuncioId } = req.body || {};

    // Validaciones básicas
    const aValid = usuarioAId && Types.ObjectId.isValid(String(usuarioAId));
    const bValid = usuarioBId && Types.ObjectId.isValid(String(usuarioBId));
    if (!aValid && !bValid) {
      return res.status(400).json({ mensaje: "Falta usuario destino" });
    }

    // Normalizar IDs y determinar "other"
    usuarioAId = aValid ? asObjectId(usuarioAId) : null;
    usuarioBId = bValid ? asObjectId(usuarioBId) : null;

    let other = null;
    if (usuarioAId && String(usuarioAId) !== String(me)) other = usuarioAId;
    if (usuarioBId && String(usuarioBId) !== String(me)) other = usuarioBId;

    if (!other || String(other) === String(me)) {
      return res.status(400).json({ mensaje: "Falta usuario destino válido" });
    }

    // Verificar existencia de ambos usuarios
    const [yo, el] = await Promise.all([
      Usuario.findById(me).select("_id"),
      Usuario.findById(other).select("_id"),
    ]);
    if (!yo || !el) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    // Buscar chat existente exacto
    let chat = await Chat.findOne({
      tipo: "privado",
      participantes: { $all: [me, other], $size: 2 },
      ...(anuncioId ? { anuncioId: asObjectId(anuncioId) } : {}),
    }).populate("participantes", "_id nombre nickname correo fotoPerfil tipo");

    // Restaurar si estaba eliminado para mí
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

    // Crear si no existe
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
// controllers/chatController.js
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

      // Normaliza arrays para evitar $in con null
      { $addFields: {
          _favoritesBySafe: { $ifNull: ["$favoritesBy", []] },
          _blockedBySafe:   { $ifNull: ["$blockedBy",   []] },
        }
      },
      { $addFields: {
          isFavorite: { $in: [uidObj, "$_favoritesBySafe"] },
          isBlocked:  { $in: [uidObj, "$_blockedBySafe"] },
        }
      },

      // Orden por actividad (favoritos arriba)
      { $sort: { isFavorite: -1, ultimoMensajeAt: -1, updatedAt: -1 } },
      { $limit: 200 },

      {
        $lookup: {
          from: "usuarios",               // colección de Usuario
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
    // Loguea el error real para que lo veas en consola del server
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

    const mensajes = await Mensaje.find({ chat: chatId })
      .sort({ createdAt: 1 })
      .lean();

    const normalizados = mensajes.map((m) => {
      if (!m.replyTo && m.reply) m.replyTo = m.reply;
      return m;
    });

    return res.json(normalizados);
  } catch (e) {
    console.error("obtenerMensajes:", e);
    return res.status(500).json({ mensaje: "Error al obtener mensajes" });
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
   Pins por usuario (robusto)
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
    return res.json(mensajes);
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
    const texto = sanitizeTexto((req.body || {}).texto);

    if (!isValidObjectId(messageId)) {
      return res.status(400).json({ mensaje: "messageId inválido" });
    }
    if (!texto) {
      return res.status(400).json({ mensaje: "Texto inválido" });
    }

    const msg = await Mensaje.findById(messageId);
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    // Debe ser autor del mensaje
    if (String(msg.emisor) !== String(uid)) {
      return res.status(403).json({ mensaje: "Solo puedes editar tus propios mensajes" });
    }

    msg.texto = texto;
    msg.editedAt = new Date();
    await msg.save();

    return res.json({ ok: true, mensaje: msg });
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

    // Debe ser autor del mensaje
    if (String(msg.emisor) !== String(uid)) {
      return res.status(403).json({ mensaje: "Solo puedes borrar tus propios mensajes" });
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

module.exports = {
  ensurePrivado,
  listarChats,
  obtenerMensajes,
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
  // admin (si los usas)
  // adminListarMensajes,
  // adminEliminarChat,
};
