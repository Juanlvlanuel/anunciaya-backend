// routes/mediaRoutes.js (CommonJS)
const express = require("express");
const verificarToken = require("../middleware/verificarToken");
const { signUpload } = require("../controllers/mediaController");

const router = express.Router();

// Protegido: genera firma segura para subida directa a Cloudinary
router.post("/sign", verificarToken, signUpload);

module.exports = router;
