// controllers/logosCarouselController-1.js
// Basado en tu archivo original. Se agregan validaciones de entrada, saneamiento de nombre, 
// chequeos de mimetype/extensión, creación segura de carpeta destino y manejo de errores uniforme.
// Lógica principal (renombrar, validar dimensiones y guardar en Mongo) se mantiene.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const LogosCarousel = require("../models/LogosCarousel");

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const MAX_WIDTH = 800;
const MAX_HEIGHT = 300;
const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "carousel-logos");

// ✅ Obtener logos (igual que original, con try/catch)
const obtenerLogos = async (req, res) => {
  try {
    const logos = await LogosCarousel.find();
    return res.json(logos);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ mensaje: "Error al obtener logos" });
  }
};

// ✅ Crear logo con validación adicional y sin romper tu flujo original
const crearLogo = async (req, res) => {
  try {
    const nombreRaw = (req.body?.nombre || "").toString().trim();
    const ordenRaw = req.body?.orden;

    if (!req.file) {
      return res.status(400).json({ mensaje: "No se subió ningún archivo." });
    }

    // Validar que el archivo sea imagen
    const mimetype = (req.file.mimetype || "").toLowerCase();
    if (!mimetype.startsWith("image/")) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ mensaje: "El archivo debe ser una imagen válida." });
    }

    // Asegura carpeta de destino
    try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}

    // Saneamiento del nombre y extensión
    const extension = (path.extname(req.file.originalname) || "").toLowerCase();
    if (extension && !ALLOWED_EXT.has(extension)) {
      // Si la extensión no es permitida, borra el temporal y falla
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ mensaje: "Extensión no permitida. Usa JPG, PNG, WEBP, HEIC/HEIF." });
    }

    const nombreSeguro = (nombreRaw || "logo").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 60) || "logo";
    const nuevoNombreArchivo = `${nombreSeguro}-${Date.now()}${extension || ".png"}`;

    // Rutas (renombrado como en tu lógica original)
    const archivoOriginal = req.file.filename;
    const rutaAntigua = path.join(UPLOADS_DIR, archivoOriginal);
    const rutaNueva = path.join(UPLOADS_DIR, nuevoNombreArchivo);

    // Renombrar físico
    fs.renameSync(rutaAntigua, rutaNueva);

    // Validar dimensiones
    const metadata = await sharp(rutaNueva).metadata();
    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      try { fs.unlinkSync(rutaNueva); } catch (_) {}
      return res.status(400).json({
        mensaje: `❌ Las dimensiones del logo exceden el máximo permitido (${MAX_WIDTH}px × ${MAX_HEIGHT}px). Tu imagen es de ${metadata.width}px × ${metadata.height}px.`,
      });
    }

    // Normaliza "orden" a número seguro
    const orden = Number.isFinite(Number(ordenRaw)) ? Number(ordenRaw) : 0;

    const nuevoLogo = new LogosCarousel({
      nombre: nombreSeguro,
      archivo: nuevoNombreArchivo,
      orden,
      activo: true,
    });

    await nuevoLogo.save();
    return res.status(201).json({ mensaje: "✅ Logo creado correctamente", logo: nuevoLogo });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ mensaje: "Error al crear el logo" });
  }
};

module.exports = {
  obtenerLogos,
  crearLogo,
};
