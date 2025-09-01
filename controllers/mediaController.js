// controllers/mediaController-1.js
// Cloudinary signed uploads — avatar, chat y negocios (sin exponer upload_preset al cliente).
// Genera respuesta en formato { uploadUrl, fields } para POST directo a Cloudinary.
// Mantiene compatibilidad con llamadas previas (devolviendo también campos planos).

const crypto = require("crypto");
require("../utils/cloudinary"); // Inicializa config/env

function sha1Hex(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function month2(mm) {
  const n = Number(mm);
  return n < 10 ? `0${n}` : String(n);
}

function buildThumbFromSecureUrl(url) {
  try {
    if (!url) return null;
    const parts = String(url).split("/upload/");
    if (parts.length < 2) return url;
    // Inserta transformación para miniatura
    const t = "w_400,h_400,c_fill,q_auto,f_auto";
    return parts[0] + "/upload/" + t + "/" + parts[1];
  } catch { return url; }
}

async function signUpload(req, res) {
  try {
    let {
      upload_preset, // guía interna, no se devuelve
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

      // Negocio
      negocioId,
      userId, // opcional para tags/context; si no, tomamos del token
    } = req.body || {};

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = month2(now.getUTCMonth() + 1);
    const finalEnv = env || (process.env.NODE_ENV === "production" ? "prod" : "dev");

    // Identidad del usuario (para etiquetar assets)
    const uid = req.usuarioId || req.usuario?._id || userId || null;

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
        uid ? `user:${uid}` : null,
      ].filter(Boolean);
      if (!tags) tags = defaultTags;
      if (!context) {
        context = {
          ...(chatId ? { chat: chatId } : {}),
          ...(messageId ? { msg: messageId } : {}),
          ...(uid ? { sender: uid } : {}),
        };
      }
    }

    // === NEGOCIOS ===
    if (negocioId) {
      folder = `anunciaya/${finalEnv}/negocios/${negocioId}/images/${yyyy}/${mm}`;
      const defaultTags = [
        "app:anunciaya",
        `env:${finalEnv}`,
        "cat:Negocio",
        `negocio:${negocioId}`,
        uid ? `user:${uid}` : null,
      ].filter(Boolean);
      if (!tags) tags = defaultTags;
      if (!context) {
        context = {
          negocio: negocioId,
          ...(uid ? { owner: uid } : {}),
        };
      }
      // public_id opcional, Cloudinary asigna si no se manda
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
      transformation: "c_limit,w_1600,h_1600,q_auto:good,f_auto",
    };

    const baseStr = Object.entries(paramsToSign)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

    const signature = sha1Hex(baseStr + process.env.CLOUDINARY_API_SECRET);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;

    // Respuesta para POST directo a Cloudinary
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
    const fields = {
      api_key: apiKey,
      signature,
      ...paramsToSign,
    };

    return res.json({
      // Formato recomendado
      uploadUrl,
      fields,

      // Compatibilidad con formato anterior
      cloudName,
      apiKey,
      timestamp: paramsToSign.timestamp,
      signature,
      transformation: paramsToSign.transformation,
      ...(folder ? { folder } : {}),
      ...(public_id ? { public_id } : {}),
      ...(overwrite ? { overwrite: true } : {}),
      ...(invalidate ? { invalidate: true } : {}),
      ...(paramsToSign.tags ? { tags: paramsToSign.tags } : {}),
      ...(paramsToSign.context ? { context: paramsToSign.context } : {}),

      // Cliente calculará thumbUrl tras la subida usando buildThumbFromSecureUrl(url).
      // (No se puede conocer url hasta terminar el upload).
    });
  } catch (err) {
    console.error("Error firmando upload:", err);
    return res.status(500).json({ error: "Error al generar la firma de Cloudinary" });
  }
}

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
    try { tail = decodeURIComponent(tail); } catch { }
    return tail;
  } catch { return null; }
}

async function destroyAsset(req, res) {
  try {
    const cloudinary = require("../utils/cloudinary");
    const { public_id, url } = req.body || {};
    let pid = public_id || null;
    if (!pid && url) pid = extractPublicIdFromUrl(url);
    if (!pid) return res.status(400).json({ error: "Falta public_id o url" });
    const out = await cloudinary.uploader.destroy(pid, { invalidate: true, resource_type: "image" });
    return res.json({ ok: true, public_id: pid, result: out });
  } catch (err) {
    console.error("Destroy Cloudinary error:", err);
    return res.status(500).json({ error: "No se pudo eliminar en Cloudinary" });
  }
}

module.exports = { signUpload, destroyAsset, buildThumbFromSecureUrl };
