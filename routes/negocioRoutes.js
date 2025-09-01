// routes/negocioRoutes-1.js
const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");
const {
  listarNegociosPublicos,
  crearNegocio,
  conteoMisNegocios,
  listarMisNegocios,
  toggleActivo,
  editarNegocio,
  borrarNegocio,
  actualizarFotosNegocio,
  obtenerNegocioPorId,
} = require("../controllers/negocioController");

// Todas protegidas, igual que tu versión actual.
router.use(verificarToken);

// Listado "público" (para app autenticada)
router.get("/public", listarNegociosPublicos);

// Mis negocios (definir ANTES de cualquier '/:id')
router.get("/mis/count", conteoMisNegocios);
router.get("/mis", listarMisNegocios);

// Operaciones por ID (segmentos específicos primero)
router.patch("/:id/toggle-activo", toggleActivo);
router.patch("/:id/fotos", actualizarFotosNegocio);
router.patch("/:id", editarNegocio);
router.delete("/:id", borrarNegocio);

// Crear
router.post("/", crearNegocio);

// Detalle por ID — dejar al FINAL para no capturar '/mis'
router.get("/:id", obtenerNegocioPorId);

module.exports = router;
