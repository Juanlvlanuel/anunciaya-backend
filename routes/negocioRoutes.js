// routes/negocioRoutes.js (parche) — añade GET /api/negocios con filtros (?mine, ?estado, ?activo)
const express = require("express");
const router = express.Router();
const verificarToken = require("../middleware/verificarToken");

const {
  listarNegocios,
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

// Protegidas (igual que tu versión actual)
router.use(verificarToken);

// NUEVO: listados con filtros (?mine, ?estado, ?activo)
router.get("/", listarNegocios);

// Listado "público" (app autenticada)
router.get("/public", listarNegociosPublicos);

// Mis negocios
router.get("/mis/count", conteoMisNegocios);
router.get("/mis", listarMisNegocios);

// Operaciones por ID
router.patch("/:id/toggle-activo", toggleActivo);
router.patch("/:id/fotos", actualizarFotosNegocio);
router.patch("/:id", editarNegocio);
router.delete("/:id", borrarNegocio);
router.patch("/:id/delete", borrarNegocio); // alias para usar helper `patch` desde FE


// Crear
router.post("/", crearNegocio);
router.patch("/create", crearNegocio); // alias para FE

// Detalle por ID — al final para no capturar /mis
router.get("/:id", obtenerNegocioPorId);

module.exports = router;
