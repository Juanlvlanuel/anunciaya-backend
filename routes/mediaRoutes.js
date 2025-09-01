
// routes/mediaRoutes-1.js (CommonJS)
const express = require("express");
const verificarToken = require("../middleware/verificarToken");
const { signUpload, destroyAsset } = require("../controllers/mediaController");

const router = express.Router();

// Protegido: firma segura para subida directa a Cloudinary
router.post("/sign", verificarToken, signUpload);

// Protegido: eliminar asset de Cloudinary
router.post("/destroy", verificarToken, destroyAsset);

module.exports = router;
