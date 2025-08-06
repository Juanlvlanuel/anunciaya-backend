const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { obtenerLogos, crearLogo } = require("../controllers/logosCarouselController");
const fs = require("fs");
const LogosCarousel = require("../models/LogosCarousel");


// Configurar almacenamiento para imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/carousel-logos");
  },
  filename: function (req, file, cb) {
  const ext = path.extname(file.originalname);
  const nombre = req.body.nombre || "logo"; // usa lo que el admin escriba
  const timestamp = Date.now();
  const nombreArchivo = `${nombre}-${timestamp}${ext}`;
  cb(null, nombreArchivo);
}

});

const upload = multer({ storage: storage });

// Rutas
router.get("/", obtenerLogos);
router.post("/", upload.single("archivo"), crearLogo);

// 🔴 ELIMINAR logo por ID
router.delete("/:id", async (req, res) => {
  try {
    const logo = await LogosCarousel.findById(req.params.id);
    if (!logo) return res.status(404).json({ mensaje: "Logo no encontrado" });

    const rutaImagen = path.join(__dirname, "..", "uploads", "carousel-logos", logo.archivo);
    if (fs.existsSync(rutaImagen)) {
      fs.unlinkSync(rutaImagen); // Eliminar archivo
    }

    await logo.deleteOne(); // Eliminar documento de MongoDB

    res.json({ mensaje: "Logo eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar logo:", error);
    res.status(500).json({ mensaje: "Error al eliminar el logo" });
  }
});

// 🔁 CAMBIAR estado activo/inactivo
router.put("/:id/estado", async (req, res) => {
  try {
    const logo = await LogosCarousel.findById(req.params.id);
    if (!logo) return res.status(404).json({ mensaje: "Logo no encontrado" });

    logo.activo = !logo.activo; // invierte el estado
    await logo.save();

    res.json({ mensaje: `Logo ${logo.activo ? "activado" : "desactivado"}`, logo });
  } catch (error) {
    console.error("Error al cambiar estado del logo:", error);
    res.status(500).json({ mensaje: "Error al cambiar estado del logo" });
  }
});

module.exports = router;

