const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");
const {
  registrarUsuario,
  loginUsuario,
  autenticarConGoogle,
  seleccionarPerfil,
} = require("../controllers/usuarioController");

// Ruta para seleccionar perfil, protegida por token
router.post("/seleccionar-perfil", verificarToken, seleccionarPerfil);
// Registro tradicional
router.post("/registro", registrarUsuario);
// Login tradicional
router.post("/login", loginUsuario);
// Login/registro con Google
router.post("/google", autenticarConGoogle);

module.exports = router;
