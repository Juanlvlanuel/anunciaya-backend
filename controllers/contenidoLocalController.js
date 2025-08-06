// ✅ controllers/contenidoLocalController.js

const filtrarPorUbicacion = require("../helpers/filtrarPorUbicacion");
const Rifas = require("../models/Rifas");
const Oferta = require("../models/Oferta");
const Subasta = require("../models/Subasta");

const obtenerContenidoLocal = async (req, res) => {
  const { lat, lng, tipo } = req.query;

  if (!lat || !lng || !tipo) {
    return res.status(400).json({ mensaje: "Faltan datos (lat, lng, tipo)" });
  }

  let Modelo;
  switch (tipo) {
    case "rifas":
      Modelo = Rifas;
      break;
    case "ofertas":
      Modelo = Oferta;
      break;
    case "subastas":
      Modelo = Subasta;
      break;
    default:
      return res.status(400).json({ mensaje: "Tipo no válido" });
  }

  const resultados = await filtrarPorUbicacion(Modelo, parseFloat(lat), parseFloat(lng));
  res.json(resultados);
};

module.exports = obtenerContenidoLocal;
