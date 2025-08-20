// controllers/sessionController.js
// Obtiene la sesión/usuario completo.

const { Usuario } = require("./_usuario.shared");

// ===================== SESIÓN (usuario actual completo) =====================
const getSession = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
    const usuario = await Usuario.findById(uid).lean();
    if (!usuario) return res.status(404).json({ mensaje: "Usuario no encontrado" });
    // Se devuelve el usuario completo (lado frontend filtrará lo necesario)
    return res.json({ usuario });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("getSession:", e);
    return res.status(500).json({ mensaje: "Error al obtener sesión" });
  }
};

module.exports = { getSession };
