const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const LogosCarousel = require("../models/LogosCarousel");

// ✅ Obtener logos
const obtenerLogos = async (req, res) => {
  try {
    const logos = await LogosCarousel.find();
    res.json(logos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: "Error al obtener logos" });
  }
};

// ✅ Crear logo con validación y renombrado
const crearLogo = async (req, res) => {
  try {
    const { nombre, orden } = req.body;

    if (!req.file) {
      return res.status(400).json({ mensaje: "No se subió ningún archivo." });
    }

    const archivoOriginal = req.file.filename;
    const extension = path.extname(req.file.originalname);
    const nuevoNombreArchivo = `${nombre}-${Date.now()}${extension}`;

    const rutaAntigua = path.join(__dirname, "..", "uploads", "carousel-logos", archivoOriginal);
    const rutaNueva = path.join(__dirname, "..", "uploads", "carousel-logos", nuevoNombreArchivo);

    fs.renameSync(rutaAntigua, rutaNueva);

    const metadata = await sharp(rutaNueva).metadata();
    const maxAncho = 800;
    const maxAlto = 300;

    if (metadata.width > maxAncho || metadata.height > maxAlto) {
      fs.unlinkSync(rutaNueva);
      return res.status(400).json({
        mensaje: `❌ Las dimensiones del logo exceden el máximo permitido (${maxAncho}px × ${maxAlto}px). Tu imagen es de ${metadata.width}px × ${metadata.height}px.`,
      });
    }

    const nuevoLogo = new LogosCarousel({
      nombre,
      archivo: nuevoNombreArchivo,
      orden: parseInt(orden),
      activo: true,
    });

    await nuevoLogo.save();

    res.status(201).json({ mensaje: "✅ Logo creado correctamente", logo: nuevoLogo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: "Error al crear el logo" });
  }
};

// ✅ Exportar ambas funciones
module.exports = {
  obtenerLogos,
  crearLogo,
};
