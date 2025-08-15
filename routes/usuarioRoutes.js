// routes/usuarioRoutes-1.js
const express = require("express");
const router = express.Router();

// Middlewares
const verificarToken = require("../middleware/verificarToken");
let requireAdmin;
try {
  requireAdmin = require("../middlewares/requireAdmin");
} catch (e) {
  // fallback noop if not present, to avoid breaking in dev
  requireAdmin = (req, res, next) => next();
}

// Controllers (toma el -1 si existe, si no el normal)
let C;
try {
  C = require("../controllers/usuarioController-1");
} catch (e) {
  C = require("../controllers/usuarioController");
}

// ===== Rutas de cuenta / auth básicas =====
router.post("/registro", C.registrarUsuario);
router.post("/login", C.loginUsuario);
router.post("/seleccionar-perfil", verificarToken, C.seleccionarPerfil);

// ===== Google OAuth =====
// Preferido (vía /auth/...)
router.post("/auth/google", C.autenticarConGoogle);   // flujo token POST (ID token)
router.get("/auth/google", C.iniciarGoogleOAuth);     // inicia consentimiento (state en cookie)
router.get("/auth/google/callback", C.googleCallbackHandler);

// Compatibilidad con rutas antiguas usadas por el frontend (evita 404)
router.post("/google", C.autenticarConGoogle);
router.get("/google", C.iniciarGoogleOAuth);
router.get("/google/callback", C.googleCallbackHandler);

// ===== Búsqueda =====
router.get("/search", C.searchUsuarios);

// ===== Admin test (API key o JWT con rol admin) =====
router.get("/admin-test", requireAdmin, (req, res) => {
  return res.json({
    mensaje: "Acceso admin concedido",
    admin: req.admin || { method: "jwt" },
  });
});

// ===== Refresh / Logout =====
const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily } = require("../helpers/tokens");

const clearRefreshCookie = (res) =>
  res.clearCookie(process.env.REFRESH_COOKIE_NAME || "rtid", {
    path: "/api/usuarios/auth/refresh",
  });

// Emite nuevo access y rota refresh (revoca el anterior). Detecta reutilización.
router.post("/auth/refresh", async (req, res) => {
  try {
    const name = process.env.REFRESH_COOKIE_NAME || "rtid";
    const raw = req.cookies?.[name];
    if (!raw) return res.status(401).json({ mensaje: "No refresh token" });

    let payload;
    try {
      payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
      });
    } catch {
      return res.status(401).json({ mensaje: "Refresh inválido" });
    }

    const tokenDoc = await RefreshToken.findOne({
      jti: payload.jti,
      userId: payload.uid,
    });
    const hash = RefreshToken.hash(raw);

    // Reutilizado / inexistente / revocado -> revocar familia completa y limpiar cookie
    if (!tokenDoc || tokenDoc.revokedAt || tokenDoc.tokenHash !== hash) {
      await revokeFamily(payload.fam);
      clearRefreshCookie(res);
      return res.status(401).json({ mensaje: "Refresh reutilizado o inválido" });
    }

    // Rotación: invalidar el actual y emitir uno nuevo de la misma familia
    tokenDoc.revokedAt = new Date();
    await tokenDoc.save();

    const newAccess = signAccess(payload.uid);
    const { refresh: newRefresh } = await signRefresh(payload.uid, payload.fam);

    res.cookie(name, newRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/usuarios/auth/refresh",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30d
    });

    return res.json({ token: newAccess });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("refresh error:", e);
    return res.status(500).json({ mensaje: "Error en refresh" });
  }
});

// Revoca refresh actual y limpia cookie
router.post("/logout", async (req, res) => {
  try {
    const name = process.env.REFRESH_COOKIE_NAME || "rtid";
    const raw = req.cookies?.[name];
    if (raw) {
      try {
        const { jti, uid } = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
          issuer: process.env.JWT_ISS,
          audience: process.env.JWT_AUD,
        });
        await RefreshToken.updateOne(
          { jti, userId: uid },
          { $set: { revokedAt: new Date() } }
        );
      } catch {}
      clearRefreshCookie(res);
    }
    res.json({ mensaje: "Sesión cerrada" });
  } catch {
    res.json({ mensaje: "Sesión cerrada" });
  }
});

module.exports = router;




