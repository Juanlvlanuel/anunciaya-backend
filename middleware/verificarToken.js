// middleware/verificarToken-1.js
// Refactor: usa helpers centralizados de utils/jwt.js
const Usuario = require("../models/Usuario");
const {
  verifyAccess,
  verifyRefresh,
  parseAuthHeader,
  REFRESH_COOKIE_NAME,
} = require("../utils/jwt");

module.exports = async (req, res, next) => {
  // 1) Intento con access token (Authorization)
  const rawHeader = req.headers["authorization"] || "";
  const accessToken = parseAuthHeader(rawHeader);

  const setUser = async (uid) => {
    if (!uid) return null;
    const usuario = await Usuario.findById(uid).lean();
    if (!usuario) return null;
    req.admin = !!(
      usuario.role === "admin" ||
      usuario.isAdmin === true ||
      (Array.isArray(usuario.scope) && usuario.scope.includes("admin"))
    );
    req.usuario = {
      _id: usuario._id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      tipo: usuario.tipo,
      perfil: usuario.perfil,
    };
    req.usuarioId = usuario._id;
    return req.usuario;
  };

  try {
    let ok = null;

    if (accessToken) {
      const decoded = verifyAccess(accessToken);
      if (decoded) {
        ok = await setUser(decoded?.uid || decoded?.id || decoded?._id || decoded?.sub);
      }
    }

    // 2) Fallback con refresh cookie
    if (!ok) {
      const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawRefresh) {
        const payload = verifyRefresh(rawRefresh);
        if (payload) {
          ok = await setUser(payload?.uid || payload?.sub || payload?._id || payload?.id);
        }
      }
    }

    if (!ok) return res.status(401).json({ mensaje: "No autenticado" });
    return next();
  } catch (e) {
    return res.status(401).json({ mensaje: "No autenticado" });
  }
};
