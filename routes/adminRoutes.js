const express = require("express");
const router = express.Router();
const Admin = require("../models/Admin");
const { autenticarAdmin } = require("../controllers/adminController"); // ✅ Agrega esto

// Ruta para registrar admin (ya la tienes)
router.post("/registro", async (req, res) => {
  const { usuario, contraseña } = req.body;

  try {
    const nuevoAdmin = new Admin({ usuario, contraseña });
    await nuevoAdmin.save();
    res.status(201).json({ msg: "Administrador creado" });
  } catch (error) {
    res.status(400).json({ msg: "Error al crear admin", error });
  }
});

// ✅ Nueva ruta de login
router.post("/login", autenticarAdmin);

// Ruta de prueba
router.get("/prueba", (req, res) => {
  res.send("Ruta admin PRUEBA funcionando");
});

module.exports = router;
