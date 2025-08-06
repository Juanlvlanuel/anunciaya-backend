// ✅ /helpers/filtrarPorUbicacion.js

/**
 * Filtra documentos de un modelo Mongoose según coordenadas y radio.
 * @param {Model} Modelo - Modelo Mongoose (Rifas, Ofertas, etc.)
 * @param {Array} coordenadas - [longitud, latitud]
 * @param {Number} radioKm - Radio de búsqueda en kilómetros (default: 100km)
 * @param {Object} filtroExtra - Filtros adicionales opcionales
 * @returns {Array} - Lista de documentos encontrados
 */
const filtrarPorUbicacion = async (Modelo, coordenadas, radioKm = 100, filtroExtra = {}) => {
  if (!Array.isArray(coordenadas) || coordenadas.length !== 2) {
    throw new Error("Coordenadas inválidas");
  }

  const [lat, lng] = coordenadas;

  const query = {
    ...filtroExtra,
    coordenadas: {
      $geoWithin: {
        $centerSphere: [[lng, lat], radioKm / 6378.1] // radio en radianes (radio tierra = 6378.1 km)
      }
    }
  };

  const resultados = await Modelo.find(query);
  return resultados;
};

module.exports = filtrarPorUbicacion;
