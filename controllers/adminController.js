// controllers/adminController.js
const Admin = require("../models/Admin");

const autenticarAdmin = async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const admin = await Admin.findOne({ usuario });
    if (!admin) {
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }

    const esCorrecto = await admin.compararPassword(contraseña);
    if (!esCorrecto) {
      return res.status(401).json({ msg: "Contraseña incorrecta" });
    }

    res.status(200).json({
      msg: "Login exitoso",
      usuario: admin.usuario,
      id: admin._id,
    });
  } catch (error) {
    res.status(500).json({ msg: "Error en el servidor", error });
  }
};

module.exports = { autenticarAdmin };
