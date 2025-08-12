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
    const me = asObjectId(getAuthUserId(req));
    let { usuarioAId, usuarioBId, anuncioId } = req.body || {};

    // Normalizar IDs y determinar "other"
    usuarioAId = usuarioAId && Types.ObjectId.isValid(usuarioAId) ? asObjectId(usuarioAId) : null;
    usuarioBId = usuarioBId && Types.ObjectId.isValid(usuarioBId) ? asObjectId(usuarioBId) : null;

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

    
    // Restaurar si estaba eliminado para mí (opción 1)
    if (chat && Array.isArray(chat.deletedFor)) {
      const meStr = String(me);
      const hasMe = chat.deletedFor.some(x => String(x) === meStr);
      if (hasMe) {
        chat.deletedFor = chat.deletedFor.filter(x => String(x) !== meStr);
        await chat.save();
        chat = await Chat.findById(chat._id).populate(
          "participantes",
          "_id nombre nickname correo fotoPerfil tipo"
        );
      }
    }

// Crear si no existe
    if (!chat) {
    // Restaurar si estaba eliminado para mí (opción 1)
    if (chat && Array.isArray(chat.deletedFor)) {
      const meStr = String(me);
      const hasMe = chat.deletedFor.some(x => String(x) == meStr);
      if (hasMe) {
        chat.deletedFor = chat.deletedFor.filter(x => String(x) != meStr);
        await chat.save();
        chat = await Chat.findById(chat._id).populate(
          "participantes",
          "_id nombre nickname correo fotoPerfil tipo"
        );
      }
    }

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

    return res.json(chat);
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
      // Campo calculado: ¿este chat es favorito para el usuario?
      { $addFields: { isFavorite: { $in: [uidObj, "$favoritesBy"] } } },
      // Orden: favoritos primero, luego por fecha
      { $sort: { isFavorite: -1, updatedAt: -1 } },
      { $limit: 200 },
      // Populate manual de participantes (solo campos necesarios)
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
          deletedFor: 1,
          pinsByUser: 1,
          ultimoMensaje: 1,
          ultimoMensajeAt: 1,
          createdAt: 1,
          updatedAt: 1,
          isFavorite: 1,
        },
      },
    ];

    const chats = await Chat.aggregate(pipeline);
    res.json(chats);
  } catch (e) {
    console.error("listarChats:", e);
    res.status(500).json({ mensaje: "Error al listar chats" });
  }
}

/* =========================
   Obtener mensajes
========================= */
async function obtenerMensajes(req, res) {
  try {
    const uid = String(req.usuario?._id || req.usuarioId || "");
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!(chat.participantes || []).some((x) => String(x) === uid)) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const mensajes = await Mensaje.find({ chat: chatId })
      .sort({ createdAt: 1 })
      .lean();

    // Compatibilidad: si hubiera datos viejos con "reply", lo mapeamos
    const normalizados = mensajes.map((m) => {
      if (!m.replyTo && m.reply) m.replyTo = m.reply;
      return m;
    });

    res.json(normalizados);
  } catch (e) {
    console.error("obtenerMensajes:", e);
    res.status(500).json({ mensaje: "Error al obtener mensajes" });
  }
}

/* =========================
   Soft delete “para mí”
========================= */
async function eliminarParaMi(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { chatId } = req.params;

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

    res.json({ ok: true });
  } catch (e) {
    console.error("eliminarParaMi:", e);
    res.status(500).json({ mensaje: "Error al eliminar chat" });
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
    res.status(500).json({ mensaje: "Error al alternar favorito" });
  }
}

async function marcarFavorito(req, res) {
  try {
    const uid = getAuthUserId(req);
    const uidObj = asObjectId(uid);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $addToSet: { favoritesBy: uidObj } });
    res.json({ ok: true, favorito: true });
  } catch (e) {
    console.error("marcarFavorito:", e);
    res.status(500).json({ mensaje: "Error al marcar favorito" });
  }
}
async function quitarFavorito(req, res) {
  try {
    const uid = getAuthUserId(req);
    const uidObj = asObjectId(uid);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    await Chat.updateOne({ _id: chatId }, { $pull: { favoritesBy: uidObj } });
    res.json({ ok: true, favorito: false });
  } catch (e) {
    console.error("quitarFavorito:", e);
    res.status(500).json({ mensaje: "Error al quitar favorito" });
  }
}

/* =========================
   Pins por usuario (robusto)
========================= */
async function fijarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

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

    res.json({ ok: true, pins: next });
  } catch (e) {
    console.error("fijarMensaje:", e);
    res.status(500).json({ mensaje: "Error al fijar mensaje" });
  }
}
async function desfijarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

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

    res.json({ ok: true, pins: next });
  } catch (e) {
    console.error("desfijarMensaje:", e);
    res.status(500).json({ mensaje: "Error al desfijar mensaje" });
  }
}
async function obtenerPins(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ mensaje: "Chat no encontrado" });

    if (!toIdStrings(chat.participantes).includes(String(uid))) {
      return res.status(403).json({ mensaje: "No autorizado" });
    }

    const ids = getPinsArray(chat, uid);
    const mensajes = ids.length
      ? await Mensaje.find({ _id: { $in: ids } }).sort({ createdAt: 1 })
      : [];
    res.json(mensajes);
  } catch (e) {
    console.error("obtenerPins:", e);
    res.status(500).json({ mensaje: "Error al obtener pins" });
  }
}

/* =========================
   Mensajes: editar y eliminar
========================= */
async function editarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;
    const { texto } = req.body || {};

    if (!texto || typeof texto !== "string") {
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

    res.json({ ok: true, mensaje: msg });
  } catch (e) {
    console.error("editarMensaje:", e);
    res.status(500).json({ mensaje: "Error al editar mensaje" });
  }
}

async function eliminarMensaje(req, res) {
  try {
    const uid = getAuthUserId(req);
    const { messageId } = req.params;

    const msg = await Mensaje.findById(messageId);
    if (!msg) return res.status(404).json({ mensaje: "Mensaje no encontrado" });

    // Debe ser autor del mensaje
    if (String(msg.emisor) !== String(uid)) {
      return res.status(403).json({ mensaje: "Solo puedes borrar tus propios mensajes" });
    }

    await Mensaje.deleteOne({ _id: messageId });

    res.json({ ok: true });
  } catch (e) {
    console.error("eliminarMensaje:", e);
    res.status(500).json({ mensaje: "Error al eliminar mensaje" });
  }
}

/* =========================
   Admin (si los usas)
========================= */
async function adminListarMensajes(req, res) {
  try {
    const { chatId } = req.params;
    const mensajes = await Mensaje.find({ chat: chatId }).sort({ createdAt: 1 });
    res.json(mensajes);
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
}
async function adminEliminarChat(req, res) {
  try {
    const { chatId } = req.params;
    await Mensaje.deleteMany({ chat: chatId });
    await Chat.findByIdAndDelete(chatId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
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
  // admin
  adminListarMensajes,
  adminEliminarChat,
};