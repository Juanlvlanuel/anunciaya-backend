
// controllers/promocionesController-1.js
// Basado en tu promocionesController.js, con validaciones estrictas de ubicación en crearPromocion.
// Mantiene la lógica existente para reacciones, guardado, visualización y obtener por ID.

const { Types } = require("mongoose");
const Oferta = require("../models/Oferta");

const ALLOWED_REACTIONS = new Set(["like", "love"]);

function isValidObjectId(id) {
  return Types.ObjectId.isValid(String(id || ""));
}
function authUid(req) {
  return String(req.usuario?._id || req.usuarioId || "");
}
function safeErr(error) {
  return process.env.NODE_ENV === "development" ? String(error && error.message) : undefined;
}

// 🔸 Agregar o alternar reacción (like/love)
const reaccionarPromocion = async (req, res) => {
  const { id } = req.params;
  const uid = authUid(req);
  const tipo = (req.body?.tipo || "").toString().toLowerCase();

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }
  if (!uid || !isValidObjectId(uid)) {
    return res.status(401).json({ mensaje: "No autenticado" });
  }
  if (!ALLOWED_REACTIONS.has(tipo)) {
    return res.status(400).json({ mensaje: "Tipo de reacción no válido" });
  }

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

    const usuarioId = uid;
    const existente = (oferta.likes || []).find((r) => String(r.usuario) === usuarioId);
    if (existente) {
      if (existente.tipo === tipo) {
        oferta.likes = oferta.likes.filter((r) => String(r.usuario) !== usuarioId);
      } else {
        existente.tipo = tipo;
      }
    } else {
      oferta.likes = oferta.likes || [];
      oferta.likes.push({ usuario: usuarioId, tipo });
    }

    await oferta.save();
    return res.status(200).json({ likes: oferta.likes });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al reaccionar", error: safeErr(error) });
  }
};

// 🔸 Guardar o desguardar promoción
const guardarPromocion = async (req, res) => {
  const { id } = req.params;
  const uid = authUid(req);

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }
  if (!uid || !isValidObjectId(uid)) {
    return res.status(401).json({ mensaje: "No autenticado" });
  }

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

    const arr = oferta.guardados || [];
    const yaGuardado = arr.some((u) => String(u) === String(uid));

    if (yaGuardado) {
      oferta.guardados = arr.filter((u) => String(u) !== String(uid));
    } else {
      oferta.guardados = [...arr, uid];
    }

    await oferta.save();
    return res.status(200).json({ guardados: oferta.guardados });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al guardar promoción", error: safeErr(error) });
  }
};

// 🔸 Aumentar visualización (una por visita) — público
const contarVisualizacion = async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }

  try {
    const updated = await Oferta.findByIdAndUpdate(id, { $inc: { visualizaciones: 1 } });
    if (!updated) return res.status(404).json({ mensaje: "Promoción no encontrada" });
    return res.status(200).json({ mensaje: "Visualización registrada" });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al contar visualización", error: safeErr(error) });
  }
};

// 🔸 Obtener detalles de una promoción — público
const obtenerPromocionPorId = async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }

  try {
    const oferta = await Oferta.findById(id)
      .populate("creador", "nombre")
      .populate("comentarios.usuario", "nombre");
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });
    return res.status(200).json(oferta);
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al obtener promoción", error: safeErr(error) });
  }
};

// 🔸 Crear nueva promoción (solo comerciantes) con ubicación obligatoria
const crearPromocion = async (req, res) => {
  try {
    const uid = authUid(req);
    if (!uid || !isValidObjectId(uid)) {
      return res.status(401).json({ mensaje: "No autenticado" });
    }
    if (req.usuario?.tipo !== "comerciante") {
      return res.status(403).json({ mensaje: "Solo comerciantes pueden crear promociones" });
    }

    const { titulo, descripcion, precio, categoria, ubicacion } = req.body || {};

    if (!titulo || !descripcion) {
      return res.status(400).json({ mensaje: "Título y descripción son obligatorios" });
    }
    if (precio != null && isNaN(Number(precio))) {
      return res.status(400).json({ mensaje: "Precio inválido" });
    }

    // Ubicación obligatoria para filtrado geoespacial
    if (!ubicacion || !Array.isArray(ubicacion.coordinates) || ubicacion.coordinates.length !== 2) {
      return res.status(400).json({ mensaje: "Ubicación inválida: envía coordinates [longitud, latitud]" });
    }
    let [lng, lat] = ubicacion.coordinates;
    lng = Number(lng); lat = Number(lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return res.status(400).json({ mensaje: "Coordenadas no numéricas (usa números en [longitud, latitud])" });
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({ mensaje: "Coordenadas fuera de rango" });
    }

    const nueva = new Oferta({
      titulo,
      descripcion,
      precio: precio != null ? Number(precio) : undefined,
      categoria: categoria || "general",
      creador: uid,
      ubicacion: { type: "Point", coordinates: [lng, lat] },
      visualizaciones: 0,
      likes: [],
      guardados: [],
    });

    await nueva.save();
    return res.status(201).json(nueva);
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al crear promoción", error: safeErr(error) });
  }
};

module.exports = {
  reaccionarPromocion,
  guardarPromocion,
  contarVisualizacion,
  obtenerPromocionPorId,
  crearPromocion,
};
