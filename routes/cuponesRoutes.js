// routes/cuponesRoutes.js — limpio y alineado con models Cupon / CuponCanje
const express = require("express");
const router = express.Router();

const {
  listExpiring,
  listAvailable,
  redeem,
  useCoupon,
  createCupon,
  removeCupon,
} = require("../controllers/cuponesController");


const verificarToken = require("../middleware/verificarToken");

// ---- Middleware: sólo comerciantes pueden crear cupones ----
function requireComerciante(req, res, next) {
  const tipo = req?.usuario?.tipo;
  const perfilNum = Number(req?.usuario?.perfil);
  const isMerchant = tipo === "comerciante" || [2, 3].includes(perfilNum); // ajusta si tus perfiles son otros
  if (!isMerchant) {
    return res
      .status(403)
      .json({ mensaje: "Solo comerciantes pueden crear cupones" });
  }
  return next();
}

// ================= Rutas ================= //

// Pública
router.get("/expiring", listExpiring);

// Requieren auth
router.get("/available", verificarToken, listAvailable);
router.post("/:id/redeem", verificarToken, redeem);
router.post("/use", verificarToken, useCoupon);

// Solo comerciante
router.post("/", verificarToken, requireComerciante, createCupon);
router.delete('/:id', verificarToken, requireComerciante, removeCupon);

module.exports = router;
