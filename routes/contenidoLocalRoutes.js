// ✅ routes/contenidoLocalRoutes.js

const express = require("express");
const router = express.Router();
const obtenerContenidoLocal = require("../controllers/contenidoLocalController");

router.get("/", obtenerContenidoLocal); // /api/contenido/local?tipo=rifas&lat=31.3&lng=-113.5

module.exports = router;
