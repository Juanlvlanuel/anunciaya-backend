// controllers/mediaController-3.js
// Cloudinary signed uploads — respuesta sin `upload_preset` (avatar y chat).
// - Mantiene `upload_preset` SOLO para lógica interna (no se expone al cliente).
// - Avatar: folder .../users/<uid>/avatar  -> public_id="avatar", overwrite/invalidate true.
// - Chat:   preset "chat_image" o si llega chatId -> organiza en anunciaya/<env>/chats/<chatId>/images/<yyyy>/<mm>.

const crypto = require("crypto");
require("../utils/cloudinary"); // Inicializa config/env

function signParams(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
  const base = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  return crypto.createHash("sha1").update(base + process.env.CLOUDINARY_API_SECRET).digest("sha1");
}

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function month2(mm) {
  const n = Number(mm);
  return n < 10 ? `0${n}` : String(n);
}

async function signUpload(req, res) {
  try {
    let {
      upload_preset, // usado solo para lógica interna (no se devuelve)
      folder,
      env,
      tags,
      context,
      public_id,
      overwrite,
      invalidate,
      chatId,
      messageId,
      senderId,
    } = req.body || {};

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = month2(now.getUTCMonth() + 1);
    const finalEnv = env || (process.env.NODE_ENV === "production" ? "prod" : "dev");

    // === AVATAR ===
    const isAvatarFolder = folder && /\/users\/[^/]+\/avatar\/?$/.test(String(folder));
    if (isAvatarFolder) {
      public_id = "avatar";
      overwrite = true;
      invalidate = true;
      upload_preset = "users_avatar"; // interno
    }

    // === CHAT ===
    if ((upload_preset === "chat_image" || chatId) && chatId) {
      folder = `anunciaya/${finalEnv}/chats/${chatId}/images/${yyyy}/${mm}`;
      if (messageId) public_id = String(messageId);
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

    // === Firma ===
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
    const baseStr = Object.entries(paramsToSign)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const signature = sha1(baseStr + process.env.CLOUDINARY_API_SECRET);

    return res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp: paramsToSign.timestamp,
      signature,
      // ❌ Nunca devolvemos upload_preset
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
