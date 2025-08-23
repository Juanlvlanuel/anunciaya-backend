// controllers/mediaCleanupController.js
// Limpia avatares antiguos en Cloudinary, conservando el actual (public_id 'avatar').

const cloudinary = require("../utils/cloudinary");

/**
 * Body esperado:
 * {
 *   "userId": "<uid>",
 *   "env": "dev" | "prod"
 * }
 */
async function purgeOldAvatars(req, res) {
  try {
    const uid = req.body?.userId || req.usuario?._id;
    const env = req.body?.env || (process.env.NODE_ENV === "production" ? "prod" : "dev");
    if (!uid) return res.status(400).json({ error: "userId requerido" });

    const prefix = `anunciaya/${env}/users/${uid}/avatar/`;
    const keepPublicId = `${prefix}avatar`;

    // Listar todos los resources bajo la carpeta
    const all = await cloudinary.api.resources({
      type: "upload",
      prefix,
      max_results: 500,
    });

    const toDelete = (all.resources || [])
      .map(r => r.public_id)
      .filter(pid => pid !== keepPublicId);

    let deleted = [];
    for (const pid of toDelete) {
      try {
        await cloudinary.uploader.destroy(pid, { invalidate: true });
        deleted.push(pid);
      } catch (e) {}
    }

    return res.json({ ok: true, prefix, kept: keepPublicId, deleted });
  } catch (e) {
    console.error("purgeOldAvatars:", e);
    return res.status(500).json({ error: "No se pudo limpiar avatares antiguos" });
  }
}

module.exports = { purgeOldAvatars };
