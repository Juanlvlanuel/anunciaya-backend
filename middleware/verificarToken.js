const jwt = require("jsonwebtoken");
const Usuario = require("../models/Usuario");

const verificarToken = async (req, res, next) => {
  let token = req.headers["authorization"];
  if (!token) return res.status(401).json({ mensaje: "No token. Acceso denegado" });

  if (token.startsWith("Bearer ")) token = token.slice(7, token.length);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Token decodificado:", decoded);
    // 🔴 Corrige aquí para aceptar cualquier variante de id
    const usuarioId = decoded.uid || decoded.id || decoded._id;
    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) return res.status(401).json({ mensaje: "Token inválido (usuario no existe)" });
    req.usuario = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ mensaje: "Token inválido" });
  }
};

module.exports = verificarToken;
