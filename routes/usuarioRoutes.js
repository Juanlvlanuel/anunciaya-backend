// routes/usuarioRoutes-1.js

const express = require("express");
const router = express.Router();

const verificarToken = require("../middleware/verificarToken");
const { 
  registrarUsuario,
  loginUsuario,
  autenticarConGoogle,
  seleccionarPerfil,
  googleCallbackHandler,
  searchUsuarios,
  iniciarGoogleOAuth,            // ⬅️ nuevo import
} = require("../controllers/usuarioController");

const rateLimit = ({ windowMs = 60_000, max = 10 } = {}) => {
  const hits = new Map();
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

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

router.use(express.json({ limit: "2mb" }));
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

const noStore = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

// ==== rutas ====
router.get("/auth/google", iniciarGoogleOAuth); // ⬅️ nueva ruta para iniciar OAuth con state

router.post("/seleccionar-perfil", verificarToken, noStore, seleccionarPerfil);
router.post("/registro", rateLimit({ windowMs: 60_000, max: 20 }), noStore, registrarUsuario);
router.post("/login", rateLimit({ windowMs: 60_000, max: 5 }), noStore, loginUsuario);
router.post("/google", rateLimit({ windowMs: 60_000, max: 10 }), noStore, autenticarConGoogle);
router.get("/auth/google/callback", googleCallbackHandler);
router.get("/search", rateLimit({ windowMs: 60_000, max: 30 }), searchUsuarios);

module.exports = router;
