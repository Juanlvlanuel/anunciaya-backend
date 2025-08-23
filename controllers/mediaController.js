// controllers/mediaController.js (CommonJS)
const crypto = require("crypto");
const cloudinary = require("../utils/cloudinary"); // asegura que inicialice config

// Utilidad para firmar parámetros en orden alfabético (requerido por Cloudinary)
function signParams(params, apiSecret) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
  const sortedKeys = Object.keys(filtered).sort();
  const toSign = sortedKeys.map((k) => `${k}=${filtered[k]}`).join("&") + apiSecret;
  return require("crypto").createHash("sha1").update(toSign).digest("hex");
}

// POST /api/media/sign
// Body: { upload_preset, folder, tags?, context? }
async function signUpload(req, res) {
  try {
    const { upload_preset, folder, tags, context } = req.body || {};
    if (!upload_preset || !folder) {
      return res.status(400).json({ error: "Faltan 'upload_preset' y/o 'folder'." });
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = {
      timestamp,
      upload_preset,
      folder,
      ...(tags ? { tags: Array.isArray(tags) ? tags.join(",") : tags } : {}),
      ...(context ? { context: Object.entries(context).map(([k,v]) => `${k}=${v}`).join("|") } : {}),
    };
    const signature = signParams(paramsToSign, process.env.CLOUDINARY_API_SECRET);
    return res.json({
      timestamp,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      upload_preset,
      folder,
      ...(paramsToSign.tags ? { tags: paramsToSign.tags } : {}),
      ...(paramsToSign.context ? { context: paramsToSign.context } : {}),
    });
  } catch (err) {
    console.error("Error firmando upload:", err);
    return res.status(500).json({ error: "Error al generar la firma de Cloudinary" });
  }
}

module.exports = { signUpload };
