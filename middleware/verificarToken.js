// middleware/verificarToken-1.js
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

module.exports = async (req, res, next) => {
  let token = req.headers["authorization"] || "";

  const trySetUserFromAccess = async (raw) => {
    let t = String(raw || "").trim();
    if (!t) return null;
    if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
    else if (t.toLowerCase().startsWith("token ")) t = t.slice(6).trim();

    const options = {};
    if (process.env.JWT_ISS) options.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) options.audience = process.env.JWT_AUD;

    const secrets = [process.env.JWT_SECRET, process.env.ACCESS_JWT_SECRET].filter(Boolean);

    let decoded = null;
    for (const sec of secrets) {
      if (decoded) break;
      try { decoded = jwt.verify(t, sec, options); } catch {}
    }
    if (!decoded) {
      for (const sec of secrets) {
        if (decoded) break;
        try { decoded = jwt.verify(t, sec); } catch {}
      }
    }
    if (!decoded) return null;

    const usuarioId = decoded?.uid || decoded?.id || decoded?._id || decoded?.sub;
    if (!usuarioId) return null;

    const usuario = await Usuario.findById(usuarioId).lean();
    if (!usuario) return null;

    req.admin = !!(usuario.role === "admin" || usuario.isAdmin === true || (Array.isArray(usuario.scope) && usuario.scope.includes("admin")));
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

  const trySetUserFromRefresh = async () => {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return null;
    let payload = null;
    try {
      payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
      });
    } catch { return null; }

    const uid = payload?.uid;
    if (!uid) return null;

    const usuario = await Usuario.findById(uid).lean();
    if (!usuario) return null;

    req.admin = !!(usuario.role === "admin" || usuario.isAdmin === true || (Array.isArray(usuario.scope) && usuario.scope.includes("admin")));
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
    // 1) Intento con access token (Authorization)
    let ok = await trySetUserFromAccess(token);
    if (!ok) {
      // 2) Fallback: si hay refresh cookie válida, usamos su uid (sin rotarla)
      ok = await trySetUserFromRefresh();
    }
    if (!ok) return res.status(401).json({ mensaje: "No autenticado" });

    return next();
  } catch {
    return res.status(401).json({ mensaje: "No autenticado" });
  }
};
