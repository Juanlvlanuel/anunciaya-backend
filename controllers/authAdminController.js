import Admin from "../models/Admin.js";

export const loginAdmin = async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const admin = await Admin.findOne({ usuario });
    if (!admin) return res.status(401).json({ msg: "Usuario no encontrado" });

    const esCorrecto = await admin.compararPassword(contraseña);
    if (!esCorrecto) return res.status(401).json({ msg: "Contraseña incorrecta" });

    // Éxito → devolver datos básicos
    res.json({
      _id: admin._id,
      usuario: admin.usuario,
      token: "autorizado123", // 🔒 más adelante usaremos JWT
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ msg: "Error del servidor" });
  }
};
