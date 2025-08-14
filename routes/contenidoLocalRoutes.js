// routes/contenidoLocalRoutes-1.js
const express = require("express");
const router = express.Router();
const obtenerContenidoLocal = require("../controllers/contenidoLocalController");

/* Cabeceras y saneamiento básico */
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

router.get("/", obtenerContenidoLocal); // /api/contenido/local?tipo=rifas&lat=31.3&lng=-113.5

module.exports = router;
