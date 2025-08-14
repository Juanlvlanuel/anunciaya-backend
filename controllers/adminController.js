// controllers/adminController-1.js
const Admin = require("../models/Admin");

/**
 * Autenticación de administrador con validación y sanitización básica.
 * Mantiene la lógica original: busca por `usuario`, compara contraseña y responde datos mínimos.
 */
const autenticarAdmin = async (req, res) => {
  try {
    // 🧼 Sanitización y validación de entrada
    const rawUsuario = (req.body?.usuario ?? "").toString().trim();
    const rawPassword = (req.body?.contraseña ?? "").toString();

    if (!rawUsuario || !rawPassword) {
      return res.status(400).json({ msg: "Faltan credenciales: usuario y contraseña son obligatorios" });
    }

    // Validaciones básicas de formato (no rompemos tu flujo)
    if (rawUsuario.length < 3 || rawUsuario.length > 64) {
      return res.status(400).json({ msg: "Usuario inválido" });
    }
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      return res.status(400).json({ msg: "Contraseña inválida" });
    }

    // 🔎 Búsqueda de admin
    const admin = await Admin.findOne({ usuario: rawUsuario });
    if (!admin) {
      // No revelar si el usuario existe o no en ambientes más estrictos; aquí mantenemos tu 404
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }

    // 🔐 Comparación de contraseña
    const esCorrecto = await admin.compararPassword(rawPassword);
    if (!esCorrecto) {
      return res.status(401).json({ msg: "Contraseña incorrecta" });
    }

    // ✅ Respuesta mínima (sin exponer datos sensibles)
    return res.status(200).json({
      msg: "Login exitoso",
      usuario: admin.usuario,
      id: admin._id,
    });
  } catch (_err) {
    // No exponemos el error interno en producción
    return res.status(500).json({ msg: "Error en el servidor" });
  }
};

module.exports = { autenticarAdmin };
