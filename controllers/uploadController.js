// controllers/uploadController.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Ajustes de rendimiento de sharp
sharp.concurrency(0); // auto = núcleos disponibles
sharp.cache({ files: 64, items: 256, memory: 128 }); // cache moderada

async function moderarImagen(_buffer) {
  // hook de moderación (placeholder)
  return { allowed: true, reason: null };
}

exports.handleUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

    const isImage = req.file.mimetype.startsWith("image/");
    const absPath = req.file.path; // .../uploads/123_name.ext
    const dir = path.dirname(absPath);
    const base = path.basename(absPath, path.extname(absPath)); // 123_name

    // nombres finales (webp) y thumbnail
    const finalName = `${base}.webp`;
    const finalPath = path.join(dir, finalName);
    const thumbName = `${base}_sm.webp`;
    const thumbPath = path.join(dir, thumbName);

    let meta = { width: null, height: null };

    if (isImage) {
      // Lee una vez, rota y saca metadata
      const input = sharp(absPath, {
        failOn: "none",
        sequentialRead: true,          // lectura secuencial -> más rápido
        limitInputPixels: false,
      }).rotate();

      const info = await input.metadata();
      meta.width = info.width || null;
      meta.height = info.height || null;

      const buffer = await input.toBuffer();

      const mod = await moderarImagen(buffer);
      if (!mod.allowed) {
        try { fs.unlinkSync(absPath); } catch {}
        return res
          .status(400)
          .json({ error: "Imagen bloqueada por políticas", reason: mod.reason });
      }

      // Procesa en paralelo: grande + thumb
      await Promise.all([
        sharp(buffer, { sequentialRead: true })
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 2 }) // effort bajo = más rápido, calidad buena
          .toFile(finalPath),

        sharp(buffer, { sequentialRead: true })
          .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78, effort: 2 })
          .toFile(thumbPath),
      ]);

      // borra el original de multer
      try { fs.unlinkSync(absPath); } catch {}
    } else {
      // No-imagen: deja el archivo como llegó
      return res.status(400).json({ error: "Solo se permiten imágenes" });
    }

    const payload = {
      filename: req.file.originalname,
      url: `/uploads/${finalName}`,
      thumbUrl: `/uploads/${thumbName}`,
      mimeType: "image/webp",
      size: fs.statSync(finalPath).size,
      isImage,
      ...meta,
    };

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
