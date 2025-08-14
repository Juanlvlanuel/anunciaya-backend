// controllers/contenidoLocalController-1.js
const filtrarPorUbicacion = require("../helpers/filtrarPorUbicacion");
const Rifas = require("../models/Rifas");
const Oferta = require("../models/Oferta");
const Subasta = require("../models/Subasta");

/**
 * Obtiene contenido local por tipo cercano a lat/lng.
 * Mejora: validación de parámetros, normalización de `tipo` y manejo de errores uniforme.
 * Lógica original preservada.
 */
const obtenerContenidoLocal = async (req, res) => {
  try {
    const latRaw = req.query?.lat;
    const lngRaw = req.query?.lng;
    const tipoRaw = (req.query?.tipo || "").toString().trim().toLowerCase();

    if (!latRaw || !lngRaw || !tipoRaw) {
      return res.status(400).json({ mensaje: "Faltan datos (lat, lng, tipo)" });
    }

    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ mensaje: "Coordenadas inválidas" });
    }

    let Modelo;
    switch (tipoRaw) {
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

    const resultados = await filtrarPorUbicacion(Modelo, lat, lng);
    return res.json(resultados);
  } catch (_err) {
    return res.status(500).json({ mensaje: "Error del servidor" });
  }
};

module.exports = obtenerContenidoLocal;
