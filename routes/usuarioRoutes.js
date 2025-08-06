const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");
const {
  registrarUsuario,
  loginUsuario,
  autenticarConGoogle,
  seleccionarPerfil,
  googleCallbackHandler, // <--- IMPORTANTE: agrega esto
} = require("../controllers/usuarioController");

// Ruta para seleccionar perfil, protegida por token
router.post("/seleccionar-perfil", verificarToken, seleccionarPerfil);
// Registro tradicional
router.post("/registro", registrarUsuario);
// Login tradicional
router.post("/login", loginUsuario);
// Login/registro con Google (POST desde frontend)
router.post("/google", autenticarConGoogle);
// Callback GET para Google OAuth (este endpoint lo usa Google)
router.get("/auth/google/callback", googleCallbackHandler);

module.exports = router;
