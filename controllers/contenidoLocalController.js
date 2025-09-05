// controllers/contenidoLocalController-1.js
const filtrarPorUbicacion = require("../helpers/filtrarPorUbicacion");
const Rifas = require("../models/Rifas");
// ⛔ Oferta removida
const Subasta = require("../models/Subasta");

/**
 * Obtiene contenido local por tipo cercano a lat/lng.
 * Versión limpia: sin dependencia de 'Oferta' / Promos / Promociones.
 * - 'rifas' y 'subastas' siguen funcionando.
 * - 'ofertas' / 'promos' / 'promociones' responden 410 GONE (módulo retirado).
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

    // Tipos retirados explícitamente
    if (["ofertas", "promos", "promociones"].includes(tipoRaw)) {
      return res.status(410).json({ error: { code: "GONE", message: "El módulo fue retirado temporalmente" } });
    }

    let Modelo = null;
    switch (tipoRaw) {
      case "rifas":
        Modelo = Rifas;
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
