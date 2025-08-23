// controllers/mediaController-1.js
// Firma de Cloudinary con lógica para:
//  - Avatar de usuario: fuerza public_id="avatar", overwrite=true, invalidate=true
//  - Imágenes de ChatYA (preset chat_image): organiza por folder anunciaya/<env>/chats/<chatId>/images/<yyyy>/<mm>
//    y usa public_id=<messageId>, con tags/context útiles.
//  - NO se firma upload_preset. Solo: timestamp, folder, public_id?, overwrite?, invalidate?, tags?, context?
//
// Body esperado (según caso):
//  { upload_preset, folder?, env?, tags?, context?, public_id?, overwrite?, invalidate? }
//  // Chat extra:
//  { chatId, messageId, senderId }
//
const crypto = require("crypto");
require("../utils/cloudinary"); // Inicializa config/env

function signParams(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
  const base = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  return crypto.createHash("sha1").update(base + process.env.CLOUDINARY_API_SECRET).digest("hex");
}

function month2(mm) {
  const n = Number(mm);
  return n < 10 ? `0${n}` : String(n);
}

async function signUpload(req, res) {
  try {
    let {
      upload_preset,
      folder,
      env,
      tags,
      context,
      public_id,
      overwrite,
      invalidate,
      // Chat
      chatId,
      messageId,
      senderId,
    } = req.body || {};

    if (!upload_preset) {
      return res.status(400).json({ error: "Falta 'upload_preset'." });
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = month2(now.getUTCMonth() + 1);
    const finalEnv = env || (process.env.NODE_ENV === "production" ? "prod" : "dev");

    // === Caso AVATAR ===
    // Detecta si la carpeta apunta a .../users/<uid>/avatar
    const isAvatarFolder = folder && /\/users\/[^/]+\/avatar\/?$/.test(String(folder));
    if (isAvatarFolder) {
      public_id = "avatar";
      overwrite = true;
      invalidate = true;
    }

    // === Caso CHAT ===
    // Si el preset es chat_image y viene chatId -> construir folder y metadata
    if (upload_preset === "chat_image" && chatId) {
      folder = `anunciaya/${finalEnv}/chats/${chatId}/images/${yyyy}/${mm}`;
      if (messageId) public_id = String(messageId);
      // Tags y context por defecto si no vienen
      const defaultTags = [
        "app:anunciaya",
        `env:${finalEnv}`,
        "cat:Chat",
        chatId ? `chat:${chatId}` : null,
        senderId ? `user:${senderId}` : null,
      ].filter(Boolean);
      if (!tags) tags = defaultTags;
      if (!context) {
        context = {
          ...(chatId ? { chat: chatId } : {}),
          ...(messageId ? { msg: messageId } : {}),
          ...(senderId ? { sender: senderId } : {}),
        };
      }
    }

    // Normalización de tags/context para firma
    const paramsToSign = {
      timestamp: Math.floor(now.getTime() / 1000),
      ...(folder ? { folder } : {}),
      ...(public_id ? { public_id } : {}),
      ...(overwrite ? { overwrite: true } : {}),
      ...(invalidate ? { invalidate: true } : {}),
      ...(tags ? { tags: Array.isArray(tags) ? tags.join(",") : String(tags) } : {}),
      ...(context
        ? {
            context: Object.entries(context)
              .map(([k, v]) => `${k}=${v}`)
              .join("|"),
          }
        : {}),
    };

    const signature = signParams(paramsToSign);

    return res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp: paramsToSign.timestamp,
      signature,
      upload_preset, // devolver al cliente, pero NO va en la firma
      ...(folder ? { folder } : {}),
      ...(public_id ? { public_id } : {}),
      ...(overwrite ? { overwrite: true } : {}),
      ...(invalidate ? { invalidate: true } : {}),
      ...(paramsToSign.tags ? { tags: paramsToSign.tags } : {}),
      ...(paramsToSign.context ? { context: paramsToSign.context } : {}),
    });
  } catch (err) {
    console.error("Error firmando upload:", err);
    return res.status(500).json({ error: "Error al generar la firma de Cloudinary" });
  }
}

module.exports = { signUpload };
