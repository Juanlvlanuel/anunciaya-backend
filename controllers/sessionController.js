// controllers/sessionController-1.js
// Obtiene la sesión/usuario completo + flag hasPassword

const { Usuario } = require("./_usuario.shared");

// ===================== SESIÓN (usuario actual completo) =====================
const getSession = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    // Trae contraseña para poder calcular hasPassword (luego se elimina)
    const usuario = await Usuario.findById(uid).select("+contraseña").lean();
    if (!usuario) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const hasPassword = !!usuario.contraseña;
    delete usuario.contraseña;

    // Devuelve el usuario con el flag claro para el frontend
    return res.json({ usuario: { ...usuario, hasPassword } });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("getSession:", e);
    return res.status(500).json({ mensaje: "Error al obtener sesión" });
  }
};

module.exports = { getSession };
