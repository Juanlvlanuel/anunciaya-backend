// middleware/verificarToken.js
const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

module.exports = async (req, res, next) => {
  let token = req.headers["authorization"] || "";
  if (!token) return res.status(401).json({ mensaje: "No token. Acceso denegado" });
  if (token.startsWith("Bearer ")) token = token.slice(7).trim();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const usuarioId = decoded?.uid || decoded?.id || decoded?._id;
    if (!usuarioId) return res.status(401).json({ mensaje: "Token inválido" });

    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) return res.status(401).json({ mensaje: "Token inválido (usuario no existe)" });

    req.usuario = usuario;
    req.usuarioId = usuario._id; // 👈 usar en controladores
    next();
  } catch {
    return res.status(401).json({ mensaje: "Token inválido" });
  }
};
