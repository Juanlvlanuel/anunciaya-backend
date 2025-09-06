// routes/usuarioRoutes-1.js (Google vinculacion)
// Basado en tu archivo actual. Agrega endpoints para conexiones OAuth y vinculación/desvinculación de Google.

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
try { C = require("../controllers/usuarioController"); }
catch { C = require("../controllers/usuarioController"); }

// Controlador de seguridad (si existe)
let securityController;
try { securityController = require("../controllers/securityController"); }
catch { securityController = require("../controllers/securityController"); }

// Controlador de Google (nuevo para vinculación)
let googleController;
try { googleController = require("../controllers/googleController"); }
catch { googleController = require("../controllers/googleController"); }

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
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (["POST","PUT","PATCH"].includes(method) && !ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  return next();
});

// ===== Cuenta / Auth =====
router.post("/registro",
  rejectExtra(["correo", "email", "contraseña", "password", "nombre", "nombreCompleto", "name", "tipo", "perfil", "nickname"]),
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

// ==== Vinculación Google (nuevo) ====
router.get("/oauth/connections", verificarToken, securityController.getOAuthConnections);
router.post("/oauth/google/link",
  verificarToken,
  rejectExtra(["credential", "nonce"]),
  googleController.linkGoogle
);
router.delete("/oauth/google/link",
  verificarToken,
  rejectExtra([]),
  googleController.unlinkGoogle
);

// Perfil (autenticado)
router.patch("/me",
  verificarToken,
  rejectExtra(["nombre", "telefono", "ciudad", "direccion", "fotoPerfil", "nickname"]),
  require("../controllers/profileController").actualizarPerfil
);

// === NEW: Verificar unicidad de nickname ===
router.get("/nickname/check", require("../controllers/profileController").checkNickname);

// Actualizar nickname (campo dedicado)
router.patch("/me/nickname",
  verificarToken,
  rejectExtra(["nickname"]),
  require("../controllers/profileController").actualizarNickname
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

// ======== Seguridad: contraseña ========
router.patch("/password", verificarToken, securityController.cambiarPassword);

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

router.post("/auth/refresh", rejectExtra([]), require("../controllers/authController").refreshToken);

/* ===================== LOGOUT ===================== */
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

function isHttps(req) {
  if (req && req.secure) return true;
  const xfp = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return xfp === "https";
}

function getRefreshCookieOpts(req) {
  const https = isHttps(req);
  const secure = https ? true : false;
  const sameSite = https ? "none" : "lax";
  const cfg = (process.env.COOKIE_DOMAIN || "").trim().replace(/^\./, "");
  const host = String(req?.headers?.host || "").split(":")[0];
  const cookieDomain = (cfg && host && (host === cfg || host.endsWith("." + cfg))) ? cfg : undefined;
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    domain: cookieDomain,
  };
}

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
      } catch (_) {}
      try { res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOpts(req)); } catch {}
      try {
        const https = isHttps(req);
        res.clearCookie(REFRESH_COOKIE_NAME, {
          httpOnly: true,
          sameSite: https ? "none" : "lax",
          secure: https,
          path: "/api",
          domain: process.env.COOKIE_DOMAIN || undefined,
        });
      } catch {}
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ mensaje: "Sesión cerrada" });
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.json({ mensaje: "Sesión cerrada" });
  }
});

// ======== Verificación de correo ========
router.get("/auth/test-smtp", require("../controllers/emailController").testSMTP);
const emailController = require("../controllers/emailController");
router.post("/reenviar-verificacion",
  (req, res, next) => {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
    next();
  },
  emailController.requestVerificationEmail
);
router.get("/verificar-email", emailController.verifyEmail);
router.get("/verificar-email/:token", emailController.verifyEmail);

// ==== Teléfono (verificación OTP) ====
try {
  const { enviarCodigo, verificarCodigo } = require("../controllers/phoneController");
  router.post("/telefono/enviar-codigo",
    verificarToken,
    (req, res, next) => {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) return res.status(415).json({ error: "Content-Type debe ser application/json" });
      next();
    },
    enviarCodigo
  );
  router.post("/telefono/verificar-codigo",
    verificarToken,
    (req, res, next) => {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) return res.status(415).json({ error: "Content-Type debe ser application/json" });
      next();
    },
    verificarCodigo
  );
} catch (e) {
  console.error("No se pudo montar rutas de teléfono:", e?.message);
}

module.exports = router;
