// routes/usuarioRoutes-1.js
// Corrige la colocación de /session (estaba anidada dentro de /admin-test) y no cambia tu lógica.

const express = require("express");
const router = express.Router();

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily } = require("../helpers/tokens");

const verificarToken = require("../middleware/verificarToken");
const { rejectExtra } = require("../middleware/rejectExtra");
const requireAdmin = require("../middleware/requireAdmin");

let C;
try {
  C = require("../controllers/usuarioController-1");
} catch {
  C = require("../controllers/usuarioController");
}

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";
const getRefreshCookieOpts = (req) => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api",
    maxAge: 1000 * 60 * 60 * 24 * 14,
  };
};
const clearRefreshCookieAll = (req, res) => {
  const base = getRefreshCookieOpts(req);
  res.clearCookie(REFRESH_COOKIE_NAME, { ...base, path: "/api", maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...base, path: "/api/usuarios/auth/refresh", maxAge: 0 });
};

router.use(express.json({ limit: "5mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  return next();
});

// ===== Cuenta / Auth =====
router.post("/registro",
  rejectExtra(["correo", "email", "contraseña", "password", "nombre", "nombreCompleto", "name", "tipo", "perfil"]),
  C.registrarUsuario
);

router.post("/login",
  rejectExtra(["email", "password", "correo", "contraseña", "login"]),
  C.loginUsuario
);

router.post("/seleccionar-perfil",
  verificarToken,
  rejectExtra(["perfil"]),
  C.seleccionarPerfil
);

// Google OAuth
router.post("/auth/google",
  rejectExtra(["credential", "nonce", "tipo", "perfil"]),
  C.autenticarConGoogle
);
router.get("/auth/google", C.iniciarGoogleOAuth);
router.get("/auth/google/callback", C.googleCallbackHandler);

// Compatibilidad legacy
router.post("/google",
  rejectExtra(["credential", "nonce", "tipo", "perfil"]),
  C.autenticarConGoogle
);
router.get("/google", C.iniciarGoogleOAuth);
router.get("/google/callback", C.googleCallbackHandler);

// Perfil (autenticado)
router.patch("/me",
  verificarToken,
  rejectExtra(["nombre", "telefono", "direccion", "fotoPerfil"]),
  C.actualizarPerfil
);

// Búsqueda
router.get("/search", C.searchUsuarios);

// Admin test
router.get("/admin-test", verificarToken, requireAdmin, (req, res) => {
  return res.json({
    mensaje: "Acceso admin concedido",
    admin: req.admin || { method: "jwt" },
  });
});

// ⬇︎ Sesión actual (fuera del handler anterior)
router.get("/session", verificarToken, C.getSession);

// Refresh
router.post("/auth/refresh", rejectExtra([]), async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return res.status(401).json({ mensaje: "No refresh token" });

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

    const doc = await RefreshToken.findOne({ jti: payload.jti, userId: payload.uid });
    const incomingHash = RefreshToken.hash
      ? RefreshToken.hash(raw)
      : require("crypto").createHash("sha256").update(String(raw)).digest("hex");

    if (!doc || doc.revokedAt || doc.tokenHash !== incomingHash) {
      await revokeFamily(payload.fam);
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh reutilizado o inválido" });
    }

    doc.revokedAt = new Date();
    await doc.save();

    const access = signAccess(payload.uid);
    const { refresh: newRefresh } = await signRefresh(payload.uid, payload.fam);

    clearRefreshCookieAll(req, res);
    res.cookie(REFRESH_COOKIE_NAME, newRefresh, getRefreshCookieOpts(req));

    return res.json({ token: access });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("refresh error:", e);
    return res.status(500).json({ mensaje: "Error en refresh" });
  }
});

// Logout
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
      } catch { }
      clearRefreshCookieAll(req, res);
    }
    res.json({ mensaje: "Sesión cerrada" });
  } catch {
    res.json({ mensaje: "Sesión cerrada" });
  }
});

module.exports = router;
