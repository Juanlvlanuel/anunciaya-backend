// controllers/uploadController-1.js
// Unificado: combina "handleUpload" (solo procesa y devuelve URLs) y "subirAvatar"
// (procesa + guarda en DB + limpia anterior). Mantiene validaciones fuertes y
// compatibilidad con rutas existentes. Basado en tus dos archivos previos.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
let Usuario;
try {
  // Solo si existe el shared/Usuario, lo requerimos para subirAvatar
  ({ Usuario } = require("./_usuario.shared"));
} catch {
  try { Usuario = require("../models/Usuario"); } catch {}
}

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

// Core: procesa archivo temporal -> genera .webp y _sm.webp, devuelve info
async function procesarArchivo(absPath, mimetype) {
  const isImage = (mimetype || "").startsWith("image/");
  const isSvg = mimetype === "image/svg+xml";

  // 1) Solo imágenes
  if (!isImage) {
    try { fs.unlinkSync(absPath); } catch {}
    const err = new Error("Solo se permiten imágenes (jpg, png, webp)"); err.status = 415; throw err;
  }
  // 2) Bloquea SVG y mimetypes no permitidos
  if (isSvg || !ALLOWED_MIMES.has(mimetype)) {
    try { fs.unlinkSync(absPath); } catch {}
    const err = new Error("Tipo de archivo no permitido (usa JPG, PNG o WEBP)"); err.status = 415; throw err;
  }

  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  const finalName = `${base}.webp`;
  const finalPath = path.join(dir, finalName);
  const thumbName = `${base}_sm.webp`;
  const thumbPath = path.join(dir, thumbName);

  // Lee/rota/metadata de forma segura
  const input = sharp(absPath, { failOn: "none", sequentialRead: true, limitInputPixels: false }).rotate();
  const info = await input.metadata();
  const width = info.width || null;
  const height = info.height || null;

  // 3) Límite de megapíxeles
  if (width && height && width * height > MAX_PIXELS) {
    try { fs.unlinkSync(absPath); } catch {}
    const err = new Error(`Imagen demasiado grande (${width}x${height}).`); err.status = 413; throw err;
  }

  // 4) Convierte a buffer
  let buffer;
  try {
    buffer = await input.toBuffer();
  } catch {
    try { fs.unlinkSync(absPath); } catch {}
    const err = new Error("Formato de imagen no soportado"); err.status = 415; throw err;
  }

  // 5) Moderación (placeholder)
  const mod = await moderarImagen(buffer);
  if (!mod.allowed) {
    try { fs.unlinkSync(absPath); } catch {}
    const err = new Error("Imagen bloqueada por políticas"); err.status = 400; throw err;
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
    const err = new Error("No se pudo procesar la imagen"); err.status = 415; throw err;
  }

  // Limpia el original temporal
  try { fs.unlinkSync(absPath); } catch {}

  // Tamaño final
  let size = null;
  try { size = fs.statSync(finalPath).size; } catch {}

  return {
    url: `/uploads/${finalName}`,
    thumbUrl: `/uploads/${thumbName}`,
    width, height, size,
  };
}

/**
 * Handler 1 — handleUpload (solo devuelve URL y thumb; no toca DB)
 * Compatibilidad con rutas existentes que usen uploadController.handleUpload
 */
async function handleUpload(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "Archivo requerido" });

    const absPath = path.resolve(req.file.path);
    const mimetype = req.file.mimetype || "";
    const out = await procesarArchivo(absPath, mimetype);

    return res.json({
      filename: req.file.originalname,
      url: out.url,
      thumbUrl: out.thumbUrl,
      mimeType: "image/webp",
      size: out.size,
      isImage: true,
      width: out.width,
      height: out.height,
    });
  } catch (e) {
    const status = e.status || 500;
    const message = status === 500 && process.env.NODE_ENV !== "development" ? "Error del servidor" : (e.message || "Error");
    return res.status(status).json({ error: message });
  }
}

/**
 * Handler 2 — subirAvatar (procesa + guarda en DB + borra anterior)
 * Compatibilidad con el flujo de MiCuenta (fotoPerfil).
 */
async function subirAvatar(req, res) {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
    if (!req.file) return res.status(400).json({ error: "Archivo requerido" });
    if (!Usuario) return res.status(500).json({ error: "Modelo Usuario no disponible" });

    const absPath = path.resolve(req.file.path);
    const mimetype = req.file.mimetype || "";

    const out = await procesarArchivo(absPath, mimetype);

    // Obtener la URL previa ANTES de actualizar
    let prevUrl = "";
    try {
      const prevDoc = await Usuario.findById(uid).select("fotoPerfil").lean();
      prevUrl = prevDoc && prevDoc.fotoPerfil ? String(prevDoc.fotoPerfil) : "";
    } catch {}

    const actualizado = await Usuario.findByIdAndUpdate(
      uid,
      { $set: { fotoPerfil: out.url } },
      { new: true, runValidators: true }
    ).lean();

    // Borrar la anterior (si estaba en /uploads y es distinta)
    try {
      if (prevUrl && prevUrl.startsWith("/uploads/") && prevUrl !== out.url) {
        const uploadsDir = path.join(__dirname, "..", "uploads");
        const prevFile = prevUrl.replace("/uploads/", "");
        const prevAbs = path.join(uploadsDir, prevFile);
        const prevThumbAbs = prevAbs.replace(/(\.[a-z0-9]+)$/i, "_sm.webp");
        try { fs.unlinkSync(prevAbs); } catch {}
        try { fs.unlinkSync(prevThumbAbs); } catch {}
      }
    } catch {}

    return res.json({ ...out, usuario: actualizado });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Error al subir avatar" });
  }
}

module.exports = { handleUpload, subirAvatar };
