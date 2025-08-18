const express = require("express");
const router = express.Router();

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily } = require("../helpers/tokens");

const verificarToken = require("../middleware/verificarToken");
const { rejectExtra } = require("../middleware/rejectExtra");
const requireAdmin = require("../middleware/requireAdmin"); // <-- ruta corregida

let C;
try {
  C = require("../controllers/usuarioController-1");
} catch {
  C = require("../controllers/usuarioController");
}

// ===== Config cookie del refresh (unificada) =====
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";
const getRefreshCookieOpts = (req) => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,                 // en localhost queda false
    sameSite: isProd ? "none" : "lax",
    path: "/api",                   // <— unificado
    maxAge: 1000 * 60 * 60 * 24 * 14,
  };
};
const clearRefreshCookieAll = (req, res) => {
  const base = getRefreshCookieOpts(req);
  // limpia en ambos paths por si quedó basura antigua
  res.clearCookie(REFRESH_COOKIE_NAME, { ...base, path: "/api", maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...base, path: "/api/usuarios/auth/refresh", maxAge: 0 });
};

// === Seguridad mínima de Content-Type para métodos de escritura ===
router.use(express.json({ limit: "1.5mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST","PUT","PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  return next();
});

// ===== Rutas de cuenta / auth =====
// Registro: solo campos permitidos (sin forzar tipos para no romper perfil numérico)
router.post(
  "/registro",
  rejectExtra(["correo","email","contraseña","password","nombre","nombreCompleto","name","tipo","perfil"]),
  C.registrarUsuario
);

// Login: alias de entrada permitidos (se mantiene la validación actual)
router.post(
  "/login",
  rejectExtra(["email", "password", "correo", "contraseña", "login"]),
  C.loginUsuario
);

// seleccionar-perfil: solo permitir 'perfil' (se mantiene verificarToken primero)
router.post(
  "/seleccionar-perfil",
  verificarToken,
  rejectExtra(["perfil"]),
  C.seleccionarPerfil
);

// ===== Google OAuth =====
router.post(
  "/auth/google",
  rejectExtra(["credential", "nonce", "tipo", "perfil"]),
  C.autenticarConGoogle
);
router.get("/auth/google", C.iniciarGoogleOAuth);
router.get("/auth/google/callback", C.googleCallbackHandler);

// Compatibilidad legacy
router.post(
  "/google",
  rejectExtra(["credential", "nonce", "tipo", "perfil"]),
  C.autenticarConGoogle
);
router.get("/google", C.iniciarGoogleOAuth);
router.get("/google/callback", C.googleCallbackHandler);

// ===== Búsqueda =====
router.get("/search", C.searchUsuarios);

// ===== Admin test (protegido) =====
router.get("/admin-test", verificarToken, requireAdmin, (req, res) => {
  return res.json({
    mensaje: "Acceso admin concedido",
    admin: req.admin || { method: "jwt" },
  });
});

// ===== NUEVO: sesión actual (paso 1) =====
router.get("/session", verificarToken, (req, res) => {
  // Devuelve la información mínima y segura del usuario ya adjunta por verificarToken
  return res.json({ usuario: req.usuario });
});

// ===== Refresh (rotación de un solo uso) =====
router.post("/auth/refresh", rejectExtra([]), async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return res.status(401).json({ mensaje: "No refresh token" });

    // 1) Verificar firma
    let payload;
    try {
      payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
      });
    } catch {
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh inválido" });
    }

    // 2) Coincidencia exacta con DB (evita reutilización)
    const doc = await RefreshToken.findOne({ jti: payload.jti, userId: payload.uid });
    const incomingHash = RefreshToken.hash
      ? RefreshToken.hash(raw)
      : require("crypto").createHash("sha256").update(String(raw)).digest("hex");

    if (!doc || doc.revokedAt || doc.tokenHash !== incomingHash) {
      await revokeFamily(payload.fam);
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh reutilizado o inválido" });
    }

    // 3) Revocar usado
    doc.revokedAt = new Date();
    await doc.save();

    // 4) Emitir nuevos tokens
    const access = signAccess(payload.uid);
    const { refresh: newRefresh } = await signRefresh(payload.uid, payload.fam);

    // 5) Rotar cookie (limpia ambos paths y setea sólo en /api)
    clearRefreshCookieAll(req, res);
    res.cookie(REFRESH_COOKIE_NAME, newRefresh, getRefreshCookieOpts(req));

    return res.json({ token: access });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("refresh error:", e);
    return res.status(500).json({ mensaje: "Error en refresh" });
  }
});

// ===== Logout: revoca y limpia cookie =====
router.post("/logout", async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (raw) {
      try {
        const { jti, uid } = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
          issuer: process.env.JWT_ISS,
          audience: process.env.JWT_AUD,
        });
        await RefreshToken.updateOne({ jti, userId: uid }, { $set: { revokedAt: new Date() } });
      } catch {}
      clearRefreshCookieAll(req, res);
    }
    res.json({ mensaje: "Sesión cerrada" });
  } catch {
    res.json({ mensaje: "Sesión cerrada" });
  }
});

module.exports = router;
