// ✅ routes/promocionesRoutes.js

const express = require("express");
const router = express.Router();
const {
  reaccionarPromocion,
  guardarPromocion,
  contarVisualizacion,
  obtenerPromocionPorId
} = require("../controllers/promocionesController");

// Reaccionar a una promoción (like/love)
router.post("/:id/reaccion", reaccionarPromocion);

// Guardar/desguardar promoción
router.post("/:id/guardar", guardarPromocion);

// Contar visualización
router.post("/:id/visualizar", contarVisualizacion);

// Ver detalles completos de una promoción
router.get("/:id", obtenerPromocionPorId);

module.exports = router;

