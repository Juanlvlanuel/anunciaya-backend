// routes/adminRoutes-1.js
const express = require("express");
const router = express.Router();
const Admin = require("../models/Admin");
const { autenticarAdmin } = require("../controllers/adminController");

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

// 🔒 Cabeceras de seguridad ligeras para este router
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// 🔒 Limita tamaño y fuerza JSON en métodos que modifican estado
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

// Ruta para registrar admin (ya la tienes)
router.post("/registro", rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const { usuario, contraseña } = req.body || {};
  if (!usuario || !contraseña) {
    return res.status(400).json({ msg: "Faltan campos obligatorios (usuario, contraseña)" });
  }

  try {
    const nuevoAdmin = new Admin({ usuario, contraseña });
    await nuevoAdmin.save();
    res.status(201).json({ msg: "Administrador creado" });
  } catch (_error) {
    res.status(400).json({ msg: "Error al crear admin" });
  }
});

// ✅ Ruta de login (con rate limiting estricto)
router.post("/login", rateLimit({ windowMs: 60_000, max: 5 }), autenticarAdmin);

// Ruta de prueba
router.get("/prueba", (_req, res) => {
  res.send("Ruta admin PRUEBA funcionando");
});

module.exports = router;
