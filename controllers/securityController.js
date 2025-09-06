// controllers/securityController-1.js
// Extraído de usuarioController.js: endpoints de seguridad
// Mantiene exactamente la misma lógica para no romper nada.

const Usuario = require("../models/Usuario");
const RefreshToken = require("../models/RefreshToken");

/** ===== Cambiar contraseña ===== */
const bcrypt = require("bcryptjs");
let jwtUtils = null;
try { jwtUtils = require("../utils/jwt"); } catch (_) { jwtUtils = null; }
const REFRESH_COOKIE_NAME = (jwtUtils && jwtUtils.REFRESH_COOKIE_NAME) || process.env.REFRESH_COOKIE_NAME || "rid";

function strongEnough(pwd = "") {
  if (typeof pwd !== "string") return false;
  if (pwd.length < 8) return false;
  if (!/[a-z]/.test(pwd)) return false;
  if (!/[A-Z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  return true;
}
function minutesDiff(a, b) {
  const ms = Math.max(0, (a?.getTime?.() || a || 0) - (b?.getTime?.() || b || 0));
  return Math.ceil(ms / 60000);
}

const cambiarPassword = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const actual = (req.body?.actual || req.body?.current || "").toString();
    const nueva  = (req.body?.nueva  || req.body?.new     || "").toString();
    const confirmar = (req.body?.confirm || req.body?.repetir || "").toString();

    if (!nueva) return res.status(400).json({ mensaje: "Nueva contraseña requerida" });
    if (confirmar && nueva !== confirmar) {
      return res.status(400).json({ mensaje: "La confirmación no coincide" });
    }
    if (!strongEnough(nueva)) {
      return res.status(400).json({ mensaje: "La nueva contraseña debe tener al menos 8 caracteres, incluir mayúscula, minúscula y un número" });
    }

    const user = await Usuario.findById(uid).select("+contraseña +failedLoginCount +lockUntil +autenticadoPorGoogle +autenticadoPorFacebook");
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const now = new Date();
    if (user.lockUntil && user.lockUntil > now) {
      const mins = minutesDiff(user.lockUntil, now);
      return res.status(429).json({ mensaje: `Demasiados intentos. Intenta de nuevo en ${mins} min` });
    }

    const hadPassword = !!user.contraseña;
    if (hadPassword) {
      if (!actual) return res.status(400).json({ mensaje: "Contraseña actual requerida" });
      const ok = await user.comprobarPassword(actual);
      if (!ok) {
        try {
          const max = Usuario.BLOQUEO_MAX_INTENTOS || 5;
          const mins = Usuario.BLOQUEO_MINUTOS || 3;
          user.failedLoginCount = (user.failedLoginCount || 0) + 1;
          if (user.failedLoginCount >= max) {
            user.lockUntil = new Date(Date.now() + mins * 60 * 1000);
            user.failedLoginCount = 0;
          }
          await user.save();
        } catch {}
        return res.status(401).json({ mensaje: "Contraseña actual incorrecta" });
      }
      if (typeof actual === "string" && actual === nueva) {
        return res.status(400).json({ mensaje: "La nueva contraseña no puede ser igual a la actual" });
      }
    }

    // Si era cuenta solo-OAuth, permitir setear sin 'actual'
    if (!hadPassword && !actual) {
      // ok
    }

    // Asignar nueva contraseña (pre-save hook hashea)
    user.contraseña = nueva;
    user.failedLoginCount = 0;
    user.lockUntil = null;
    await user.save();

    // Revocar otras sesiones (mantén la actual si identificamos jti)
    try {
      if (RefreshToken) {
        let currentJti = null;
        try {
          const raw = req.cookies?.[REFRESH_COOKIE_NAME];
          if (jwtUtils && typeof jwtUtils.verifyRefresh === "function" && raw) {
            const payload = jwtUtils.verifyRefresh(raw);
            currentJti = payload?.jti || null;
          }
        } catch {}
        const q = { userId: user._id, revokedAt: null };
        if (currentJti) q.jti = { $ne: currentJti };
        await RefreshToken.updateMany(q, { $set: { revokedAt: new Date(), reason: "password_change" } });
      }
    } catch {}

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al cambiar contraseña" });
  }
};

/** ===== Listar sesiones (refresh tokens) ===== */
const listarSesiones = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const docs = await RefreshToken.find({ userId: uid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const items = (docs || []).map(d => ({
      id: d.jti || String(d._id),
      activo: !d.revokedAt,
      creado: d.createdAt,
      actualizado: d.updatedAt,
      revocadoEn: d.revokedAt || null,
    }));

    return res.json({ sesiones: items });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al listar sesiones" });
  }
};

/** ===== Cerrar todas las sesiones ===== */
const cerrarTodasSesiones = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    await RefreshToken.updateMany(
      { userId: uid, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    try {
      const name = process.env.REFRESH_COOKIE_NAME || "rid";
      res.clearCookie(name, {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api",
      });
    } catch {}

    return res.json({ mensaje: "Sesiones cerradas" });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al cerrar sesiones" });
  }
};

/** ===== Conexiones OAuth (placeholders) ===== */
const getOAuthConnections = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    const u = await Usuario.findById(uid).lean();
    if (!u) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    return res.json({
      google: !!u.autenticadoPorGoogle,
      facebook: !!u.autenticadoPorFacebook,
    });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al obtener conexiones" });
  }
};

const unlinkOAuth = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    const provider = String(req.params?.provider || "").toLowerCase();
    const allowed = new Set(["google", "facebook"]);
    if (!allowed.has(provider)) {
      return res.status(400).json({ mensaje: "Proveedor inválido" });
    }

    const field = provider === "google" ? "autenticadoPorGoogle" : "autenticadoPorFacebook";
    const u = await Usuario.findByIdAndUpdate(uid, { $unset: { [field]: "" } }, { new: true }).lean();

    return res.json({ mensaje: "Desvinculado", usuario: u });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al desvincular" });
  }
};

/** ===== 2FA (placeholders) ===== */
const status2fa  = async (_req, res) => res.json({ enabled: false });
const enable2fa  = async (_req, res) => res.json({ enabled: true });
const disable2fa = async (_req, res) => res.json({ enabled: false });

module.exports = {
  cambiarPassword,
  listarSesiones,
  cerrarTodasSesiones,
  getOAuthConnections,
  unlinkOAuth,
  status2fa,
  enable2fa,
  disable2fa,
};
