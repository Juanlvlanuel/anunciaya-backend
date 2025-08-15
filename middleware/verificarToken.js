// middleware/verificarToken-1.js
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

module.exports = async (req, res, next) => {
  let token = req.headers["authorization"] || "";
  if (!token) return res.status(401).json({ mensaje: "No token. Acceso denegado" });

  if (typeof token === "string") token = token.trim();
  // Soporta variaciones comunes: "Bearer <token>" o "Token <token>"
  if (token.toLowerCase().startsWith("bearer ")) token = token.slice(7).trim();
  else if (token.toLowerCase().startsWith("token ")) token = token.slice(6).trim();

  try {
    const options = {};
    if (process.env.JWT_ISS) options.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) options.audience = process.env.JWT_AUD;

    const decoded = jwt.verify(token, process.env.JWT_SECRET, options);
    const usuarioId = decoded?.uid || decoded?.id || decoded?._id;
    if (!usuarioId) return res.status(401).json({ mensaje: "Token inválido" });

    const usuario = await Usuario.findById(usuarioId).lean();
    if (!usuario) return res.status(401).json({ mensaje: "Token inválido (usuario no existe)" });

    // Adjunta info mínima y segura
    req.usuario = usuario;
    req.usuarioId = usuario._id;
    next();
  } catch {
    return res.status(401).json({ mensaje: "Token inválido" });
  }
};
