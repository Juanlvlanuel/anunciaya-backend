// middleware/verificarToken-1.js
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

module.exports = async (req, res, next) => {
  let token = req.headers["authorization"] || "";
  if (!token) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No token. Acceso denegado" } });

  if (typeof token === "string") token = token.trim();
  // Soporta variaciones comunes: "Bearer <token>" o "Token <token>"
  if (token.toLowerCase().startsWith("bearer ")) token = token.slice(7).trim();
  else if (token.toLowerCase().startsWith("token ")) token = token.slice(6).trim();

  try {
    const options = {};
    if (process.env.JWT_ISS) options.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) options.audience = process.env.JWT_AUD;

    // Verifica con JWT_SECRET y, si existe, intenta ACCESS_JWT_SECRET como respaldo
    let decoded = null;
    const secrets = [
      process.env.JWT_SECRET,
      process.env.ACCESS_JWT_SECRET,
    ].filter(Boolean);

    // 1) Intento con opciones (iss/aud) si están definidas
    for (const sec of secrets) {
      if (decoded) break;
      try {
        decoded = jwt.verify(token, sec, options);
      } catch {}
    }

    // 2) Si no se pudo, intenta sin opciones (compatibilidad local sin iss/aud)
    if (!decoded) {
      for (const sec of secrets) {
        if (decoded) break;
        try {
          decoded = jwt.verify(token, sec);
        } catch {}
      }
    }

    if (!decoded) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token inválido" } });

    const usuarioId = decoded?.uid || decoded?.id || decoded?._id || decoded?.sub;
    if (!usuarioId) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token inválido" } });

    const usuario = await Usuario.findById(usuarioId).lean();
    if (!usuario) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token inválido (usuario no existe)" } });

    // Adjunta info mínima y segura (preservado tal como lo tienes)
    req.admin = !!(usuario.role === 'admin' || usuario.isAdmin === true || (Array.isArray(usuario.scope) && usuario.scope.includes('admin')));
    req.usuario = {
      _id: usuario._id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      tipo: usuario.tipo,
      perfil: usuario.perfil,
    };
    req.usuarioId = usuario._id;
    next();
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token inválido" } });
  }
};
