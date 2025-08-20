// controllers/securityController-1.js
// Extraído de usuarioController.js: endpoints de seguridad
// Mantiene exactamente la misma lógica para no romper nada.

const Usuario = require("../models/Usuario");
const RefreshToken = require("../models/RefreshToken");

/** ===== Cambiar contraseña ===== */
const cambiarPassword = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const actual = (req.body?.actual || req.body?.current || "").toString();
    const nueva  = (req.body?.nueva  || req.body?.new     || "").toString();
    const repetir = (req.body?.confirm || req.body?.repetir || "").toString();

    if (!actual || !nueva || !repetir) {
      return res.status(400).json({ mensaje: "Faltan campos" });
    }
    if (nueva !== repetir) {
      return res.status(400).json({ mensaje: "La confirmación no coincide" });
    }
    if (nueva.length < 6 || nueva.length > 128) {
      return res.status(400).json({ mensaje: "La contraseña debe tener entre 6 y 128 caracteres" });
    }

    const usuario = await Usuario.findById(uid).select("+contraseña");
    if (!usuario) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const ok = await usuario.comprobarPassword(actual);
    if (!ok) return res.status(401).json({ mensaje: "Contraseña actual incorrecta" });

    usuario.contraseña = nueva;
    await usuario.save();

    try {
      await RefreshToken.updateMany(
        { userId: uid, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    } catch {}

    return res.json({ mensaje: "Contraseña actualizada" });
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
