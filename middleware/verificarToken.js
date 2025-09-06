// middleware/verificarToken-1.js
// Aplica logoutAt tanto para access como para refresh y expone logoutAt en req.usuario

const Usuario = require("../models/Usuario");
const {
  verifyAccess,
  verifyRefresh,
  parseAuthHeader,
  REFRESH_COOKIE_NAME,
} = require("../utils/jwt");

module.exports = async (req, res, next) => {
  const rawHeader = req.headers["authorization"] || "";
  const accessToken = parseAuthHeader(rawHeader);

  const setUser = async (uid) => {
    if (!uid) return null;
    const u = await Usuario.findById(uid).lean();
    if (!u) return null;
    req.admin = !!(
      u.role === "admin" ||
      u.isAdmin === true ||
      (Array.isArray(u.scope) && u.scope.includes("admin"))
    );
    // Importante: incluir logoutAt para validarlo más abajo
    req.usuario = {
      _id: u._id,
      nombre: u.nombre,
      correo: u.correo,
      tipo: u.tipo,
      perfil: u.perfil,
      logoutAt: u.logoutAt || null,
    };
    req.usuarioId = u._id;
    return req.usuario;
  };

  try {
    let ok = null;

    // 1) Access token (Authorization)
    if (accessToken) {
      const decoded = verifyAccess(accessToken);
      if (decoded) {
        ok = await setUser(decoded?.uid || decoded?.sub || decoded?._id || decoded?.id);
        if (ok && ok.logoutAt) {
          const iatMs = decoded?.iat ? decoded.iat * 1000 : null;
          const cut = new Date(ok.logoutAt).getTime();
          if (!iatMs || iatMs < cut) {
            return res.status(401).json({ mensaje: "Sesión expirada" });
          }
        }
      }
    }

    // 2) Fallback: refresh cookie
    if (!ok) {
      const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
      if (rawRefresh) {
        const payload = verifyRefresh(rawRefresh);
        if (payload) {
          ok = await setUser(payload?.uid || payload?.sub || payload?._id || payload?.id);
          if (ok && ok.logoutAt) {
            const iatMs = payload?.iat ? payload.iat * 1000 : null;
            const cut = new Date(ok.logoutAt).getTime();
            if (!iatMs || iatMs < cut) {
              return res.status(401).json({ mensaje: "Sesión expirada" });
            }
          }
        }
      }
    }

    if (!ok) return res.status(401).json({ mensaje: "No autenticado" });
    return next();
  } catch (e) {
    return res.status(401).json({ mensaje: "No autenticado" });
  }
};
