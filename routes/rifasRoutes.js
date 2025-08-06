// ✅ routes/rifasRoutes.js
const express = require("express");
const router = express.Router();
const Rifas = require("../models/Rifas");

// 📌 POST: Crear una nueva rifa
router.post("/", async (req, res) => {
  try {
    const nuevaRifa = new Rifas(req.body);
    await nuevaRifa.save();
    res.status(201).json({ mensaje: "Rifa creada correctamente", rifa: nuevaRifa });
  } catch (error) {
    console.error("❌ Error al crear la rifa:", error);
    res.status(500).json({ mensaje: "Error al crear la rifa", error });
  }
});

// 📌 GET: Rifas locales (con coordenadas)
router.get("/local", async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ mensaje: "Faltan coordenadas lat/lng en la consulta" });
  }

  try {
    const rifasCercanas = await Rifas.find({
      coordenadas: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: 100000, // 100 km
        },
      },
    });

    res.json(rifasCercanas);
  } catch (error) {
    console.error("❌ Error al buscar rifas:", error);
    res.status(500).json({ mensaje: "Error al obtener rifas cercanas", error });
  }
});

// ✅ Eliminar una rifa por ID
router.delete("/:id", async (req, res) => {
  try {
    const rifaEliminada = await Rifas.findByIdAndDelete(req.params.id);
    if (!rifaEliminada) {
      return res.status(404).json({ mensaje: "Rifa no encontrada" });
    }
    res.json({ mensaje: "Rifa eliminada correctamente" });
  } catch (error) {
    console.error("❌ Error al eliminar la rifa:", error);
    res.status(500).json({ mensaje: "Error al eliminar la rifa" });
  }
});


module.exports = router;

