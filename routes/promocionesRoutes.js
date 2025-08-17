// routes/promocionesRoutes-1.js
const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");

const {
  reaccionarPromocion,
  guardarPromocion,
  contarVisualizacion,
  obtenerPromocionPorId
} = require("../controllers/promocionesController");

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

// JSON + Content-Type para POST
router.use(express.json({ limit: "1mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST","PUT","PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  next();
});

// Reaccionar a una promoción (like/love) — requiere token (evita suplantación)
router.post("/:id/reaccion", verificarToken, rateLimit({ windowMs: 60_000, max: 60 }), reaccionarPromocion);

// Guardar/desguardar promoción — requiere token
router.post("/:id/guardar", verificarToken, rateLimit({ windowMs: 60_000, max: 60 }), guardarPromocion);

// Contar visualización — público (no requiere token)
router.post("/:id/visualizar", rateLimit({ windowMs: 60_000, max: 120 }), contarVisualizacion);

// Ver detalles completos de una promoción — público
router.get("/:id", rateLimit({ windowMs: 60_000, max: 120 }), obtenerPromocionPorId);

module.exports = router;
