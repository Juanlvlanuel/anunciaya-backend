// routes/mediaCleanupRoutes.js
const express = require("express");
const verificarToken = require("../middleware/verificarToken");
const { purgeOldAvatars } = require("../controllers/mediaCleanupController");

const router = express.Router();

// Borra avatars antiguos en la carpeta de un usuario, conservando el actual (public_id: "avatar")
router.post("/cleanup/avatars", verificarToken, purgeOldAvatars);

module.exports = router;
