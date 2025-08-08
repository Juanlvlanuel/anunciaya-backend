const fs = require("fs");
const sharp = require("sharp");

async function moderarImagen(_buffer) {
  // TODO: integrar moderación real; por ahora permitir
  return { allowed: true, reason: null };
}

exports.handleUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

    const isImage = req.file.mimetype.startsWith("image/");
    let meta = { width: null, height: null };

    if (isImage) {
      const img = sharp(req.file.path, { failOn: "none" });
      const info = await img.metadata();
      meta.width = info.width || null;
      meta.height = info.height || null;

      const buffer = await img.toBuffer();
      const mod = await moderarImagen(buffer);
      if (!mod.allowed) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "Imagen bloqueada por políticas", reason: mod.reason });
      }
      await sharp(buffer).withMetadata({ exif: undefined }).toFile(req.file.path);
    }

    const payload = {
      filename: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
      isImage,
      ...meta,
    };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
