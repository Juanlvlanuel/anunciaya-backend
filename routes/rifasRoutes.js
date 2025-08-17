// routes/rifasRoutes-1.js
const express = require("express");
const router = express.Router();
const Rifas = require("../models/Rifas");

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

// Seguridad básica
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

router.use(express.json({ limit: "1.5mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST","PUT","PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ mensaje: "Content-Type debe ser application/json" });
    }
  }
  next();
});

// 📌 POST: Crear una nueva rifa
router.post("/", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  try {
    const nuevaRifa = new Rifas(req.body);
    await nuevaRifa.save();
    res.status(201).json({ mensaje: "Rifa creada correctamente", rifa: nuevaRifa });
  } catch (error) {
    console.error("❌ Error al crear la rifa:", error);
    res.status(500).json({ mensaje: "Error al crear la rifa" });
  }
});

// 📌 GET: Rifas locales (con coordenadas)
router.get("/local", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ mensaje: "Faltan coordenadas lat/lng en la consulta" });
  }

  try {
    const rifasCercanas = await Rifas.find({
      coordenadas: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: 100000, // 100 km
        },
      },
    });

    res.json(rifasCercanas);
  } catch (error) {
    console.error("❌ Error al buscar rifas:", error);
    res.status(500).json({ mensaje: "Error al obtener rifas cercanas" });
  }
});

// 📌 GET: Obtener una rifa por ID (para validar INVALID_ID via CastError)
router.get("/:id", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res, next) => {
  try {
    const rifa = await Rifas.findById(req.params.id);
    if (!rifa) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Rifa no encontrada" } });
    }
    return res.json(rifa);
  } catch (error) {
    return next(error);
  }
});

// ✅ Eliminar una rifa por ID
router.delete("/:id", rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  try {
    const rifaEliminada = await Rifas.findByIdAndDelete(req.params.id);
    if (!rifaEliminada) {
      return res.status(404).json({ mensaje: "Rifa no encontrada" });
    }
    res.json({ mensaje: "Rifa eliminada correctamente" });
  } catch (error) {
    console.error("❌ Error al eliminar la rifa:", error);
    res.status(500).json({ mensaje: "Error al eliminar la rifa" });
  }
});

module.exports = router;
