// controllers/uploadController-1.js
// Endurece validaciones: bloquea SVG y no-imágenes, limita megapíxeles y maneja errores sin 500.
// Basado en tu archivo actual.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

sharp.concurrency(0);
sharp.cache({ files: 64, items: 256, memory: 128 });

// Límites
const MAX_PIXELS = Number(process.env.UPLOAD_MAX_PIXELS || 50_000_000); // 50 MP
const FULL_SIZE = { width: 1600, height: 1600 };
const THUMB_SIZE = { width: 320, height: 320 };

// Tipos permitidos (solo imágenes seguras)
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// (Opcional) Moderación futura
async function moderarImagen(_buffer) {
  return { allowed: true, reason: null };
}

exports.handleUpload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

    const mimetype = req.file.mimetype || "";
    const isImage = mimetype.startsWith("image/");
    const isSvg = mimetype === "image/svg+xml";

    const absPath = path.resolve(req.file.path);
    const dir = path.dirname(absPath);
    const base = path.basename(absPath, path.extname(absPath)); // nombre sin extensión

    // 1) Solo imágenes
    if (!isImage) {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(400).json({ error: "Solo se permiten imágenes (jpg, png, webp)" });
    }
    // 2) Bloquea SVG y cualquier mimetype fuera de la lista
    if (isSvg || !ALLOWED_MIMES.has(mimetype)) {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(415).json({ error: "Tipo de archivo no permitido (usa JPG, PNG o WEBP)" });
    }

    // Asegura carpeta
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}

    // Salidas finales (webp)
    const finalName = `${base}.webp`;
    const finalPath = path.join(dir, finalName);
    const thumbName = `${base}_sm.webp`;
    const thumbPath = path.join(dir, thumbName);

    // Lee/rota/metadata de forma segura
    const input = sharp(absPath, {
      failOn: "none",
      sequentialRead: true,
      limitInputPixels: false,
    }).rotate();

    const info = await input.metadata();
    const width = info.width || null;
    const height = info.height || null;

    // 3) Límite de megapíxeles
    if (width && height && width * height > MAX_PIXELS) {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(413).json({
        error: `Imagen demasiado grande (${width}x${height}). Límite ${Math.round(Math.sqrt(MAX_PIXELS))} px por lado aprox.`,
      });
    }

    // 4) Convierte a buffer (si falla, no es imagen soportada)
    let buffer;
    try {
      buffer = await input.toBuffer();
    } catch {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(415).json({ error: "Formato de imagen no soportado" });
    }

    // 5) Moderación (placeholder)
    const mod = await moderarImagen(buffer);
    if (!mod.allowed) {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(400).json({ error: "Imagen bloqueada por políticas", reason: mod.reason });
    }

    // 6) Procesado (full + thumb)
    try {
      await Promise.all([
        sharp(buffer, { sequentialRead: true })
          .resize({ ...FULL_SIZE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80, effort: 2 })
          .toFile(finalPath),
        sharp(buffer, { sequentialRead: true })
          .resize({ ...THUMB_SIZE, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78, effort: 2 })
          .toFile(thumbPath),
      ]);
    } catch {
      try { fs.unlinkSync(absPath); } catch {}
      return res.status(415).json({ error: "No se pudo procesar la imagen" });
    }

    // Limpia el original temporal
    try { fs.unlinkSync(absPath); } catch {}

    // Tamaño final
    let size = null;
    try { size = fs.statSync(finalPath).size; } catch {}

    return res.json({
      filename: req.file.originalname,
      url: `/uploads/${finalName}`,
      thumbUrl: `/uploads/${thumbName}`,
      mimeType: "image/webp",
      size,
      isImage: true,
      width,
      height,
    });
  } catch (e) {
    const message = process.env.NODE_ENV === "development" ? (e?.message || "Error") : "Error del servidor";
    return res.status(500).json({ error: message });
  }
};
