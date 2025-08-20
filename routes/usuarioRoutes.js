// routes/usuarioRoutes-1.js
// FastUX: añade expiresIn/issuedAt en /auth/refresh (compatibilidad total)

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const router = express.Router();

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily } = require("../helpers/tokens");

const verificarToken = require("../middleware/verificarToken");
const { rejectExtra } = require("../middleware/rejectExtra");
const requireAdmin = require("../middleware/requireAdmin");

// Controllers principales (usuario)
let C;
try {
  C = require("../controllers/usuarioController-1");
} catch {
  C = require("../controllers/usuarioController");
}

// Controlador de seguridad (si existe)
let securityController;
try {
  securityController = require("../controllers/securityController");
} catch {
  securityController = require("../controllers/securityController-1");
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

// ======== Multer para /me/avatar ========
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "avatar").replace(/\s+/g, "_").replace(/[^\w.\-]/g, "");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const fileFilter = (req, file, cb) => {
  if (ALLOWED.has(file.mimetype)) return cb(null, true);
  req.fileValidationError = "Tipo de archivo no permitido (usa JPG, PNG o WEBP)";
  return cb(null, false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });

// Middleware general: forzar JSON excepto en /me/avatar
router.use(express.json({ limit: "5mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  const url = req.originalUrl || req.url || "";
  if (url.includes("/me/avatar")) return next(); // permitir multipart
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

// Google OAuth (One Tap + OAuth clásico)
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

// Subir avatar (multipart/form-data, campo 'avatar')
router.post("/me/avatar",
  verificarToken,
  (req, res, next) => {
    upload.single("avatar")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: { code: "BAD_REQUEST", message: err.message } });
      }
      if (err) return res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Tipo de archivo no permitido (usa JPG, PNG o WEBP)" } });
      if (!req.file) {
        const code = req.fileValidationError ? 415 : 400;
        const message = req.fileValidationError || "Archivo requerido";
        return res.status(code).json({ error: { code: code === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST", message } });
      }
      return C.subirAvatar(req, res, next);
    });
  }
);

// Búsqueda
router.get("/search", C.searchUsuarios);

// Admin test
router.get("/admin-test", verificarToken, requireAdmin, (req, res) => {
  return res.json({ mensaje: "Acceso admin concedido", admin: req.admin || { method: "jwt" } });
});

// Sesión actual
router.get("/session", verificarToken, C.getSession);

// ======== Seguridad ========
router.get("/security/sessions", verificarToken, securityController?.listarSesiones || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.post("/security/sessions/signout-all", verificarToken, securityController?.cerrarTodasSesiones || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.post("/security/password", verificarToken, securityController?.cambiarPassword || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.get("/security/connections", verificarToken, securityController?.getOAuthConnections || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.post("/security/connections/:provider/unlink", verificarToken, securityController?.unlinkOAuth || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.get("/security/2fa/status", verificarToken, securityController?.status2fa || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.post("/security/2fa/enable", verificarToken, securityController?.enable2fa || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));
router.post("/security/2fa/disable", verificarToken, securityController?.disable2fa || ((req, res)=>res.status(501).json({mensaje:"No implementado"})));

// ======== Refresh (añade expiresIn/issuedAt) ========
function parseExpiresToSeconds(expStr) {
  const s = String(expStr || "15m").trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s,10);
  const m = s.match(/^(\d+)\s*([smhd])$/);
  if (!m) return 900;
  const n = parseInt(m[1],10);
  const unit = m[2];
  const map = { s:1, m:60, h:3600, d:86400 };
  return n * (map[unit] || 60);
}

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

    const expiresIn = parseExpiresToSeconds(process.env.JWT_EXPIRES_IN || "15m");
    return res.json({ token: access, expiresIn, issuedAt: Date.now() });
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
      } catch {}
      clearRefreshCookieAll(req, res);
    }
    res.json({ mensaje: "Sesión cerrada" });
  } catch {
    res.json({ mensaje: "Sesión cerrada" });
  }
});

module.exports = router;
