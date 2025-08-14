// routes/logosCarouselRoutes-1.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { obtenerLogos, crearLogo } = require("../controllers/logosCarouselController");
const LogosCarousel = require("../models/LogosCarousel");

// 🔒 Rate limiting simple en memoria (por proceso)
const rateLimit = ({ windowMs = 60_000, max = 10 } = {}) => {
  const hits = new Map(); // key -> { count, expires }
  return (req, res, next) => {
    const key = (req.ip || req.connection?.remoteAddress || "unknown") + "|" + (req.baseUrl + req.path);
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.expires < now) {
      hits.set(key, { count: 1, expires: now + windowMs });
      return next();
    }
    if (rec.count >= max) {
      const retryAfter = Math.ceil((rec.expires - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ error: "Demasiadas solicitudes, intenta más tarde." });
    }
    rec.count += 1;
    return next();
  };
};

// Cabeceras de seguridad
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// Configurar almacenamiento para imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/carousel-logos");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const nombre = req.body.nombre || "logo";
    const timestamp = Date.now();
    const nombreArchivo = `${nombre}-${timestamp}${ext}`;
    cb(null, nombreArchivo);
  }
});

const upload = multer({ storage });

// Rutas
router.get("/", rateLimit({ windowMs: 60_000, max: 60 }), obtenerLogos);
router.post("/", rateLimit({ windowMs: 60_000, max: 15 }), upload.single("archivo"), crearLogo);

// 🔴 ELIMINAR logo por ID
router.delete("/:id", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  try {
    const logo = await LogosCarousel.findById(req.params.id);
    if (!logo) return res.status(404).json({ mensaje: "Logo no encontrado" });

    const rutaImagen = path.join(__dirname, "..", "uploads", "carousel-logos", logo.archivo);
    if (fs.existsSync(rutaImagen)) {
      fs.unlinkSync(rutaImagen); // Eliminar archivo
    }

    await logo.deleteOne(); // Eliminar documento de MongoDB

    res.json({ mensaje: "Logo eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar logo:", error);
    res.status(500).json({ mensaje: "Error al eliminar el logo" });
  }
});

// 🔁 CAMBIAR estado activo/inactivo
router.put("/:id/estado", rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  try {
    const logo = await LogosCarousel.findById(req.params.id);
    if (!logo) return res.status(404).json({ mensaje: "Logo no encontrado" });

    logo.activo = !logo.activo; // invierte el estado
    await logo.save();

    res.json({ mensaje: `Logo ${logo.activo ? "activado" : "desactivado"}`, logo });
  } catch (error) {
    console.error("Error al cambiar estado del logo:", error);
    res.status(500).json({ mensaje: "Error al cambiar estado del logo" });
  }
});

module.exports = router;
