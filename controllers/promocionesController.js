// controllers/promocionesController-1.js
// Basado en tu archivo original, con validaciones de entrada, comprobación de ObjectId,
// sanitización ligera y manejo de errores uniforme, sin cambiar la lógica de negocio.
const { Types } = require("mongoose");
const Oferta = require("../models/Oferta");

const ALLOWED_REACTIONS = new Set(["like", "love"]);

function isValidObjectId(id) {
  return Types.ObjectId.isValid(String(id || ""));
}

function safeErr(error) {
  return process.env.NODE_ENV === "development" ? String(error && error.message) : undefined;
}

// 🔸 Agregar o alternar reacción (like/love)
const reaccionarPromocion = async (req, res) => {
  const { id } = req.params;
  const usuarioId = (req.body?.usuarioId || "").toString();
  const tipo = (req.body?.tipo || "").toString().toLowerCase();

  // Validaciones básicas
  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }
  if (!isValidObjectId(usuarioId)) {
    return res.status(400).json({ mensaje: "ID de usuario inválido" });
  }
  if (!ALLOWED_REACTIONS.has(tipo)) {
    return res.status(400).json({ mensaje: "Tipo de reacción no válido" });
  }

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

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
    return res.json({ likes: oferta.likes });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al reaccionar", error: safeErr(error) });
  }
};

// 🔸 Guardar o desguardar promoción
const guardarPromocion = async (req, res) => {
  const { id } = req.params;
  const usuarioId = (req.body?.usuarioId || "").toString();

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }
  if (!isValidObjectId(usuarioId)) {
    return res.status(400).json({ mensaje: "ID de usuario inválido" });
  }

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

    const arr = oferta.guardados || [];
    const yaGuardado = arr.some((u) => String(u) === usuarioId);

    if (yaGuardado) {
      oferta.guardados = arr.filter((u) => String(u) !== usuarioId);
    } else {
      oferta.guardados = [...arr, usuarioId];
    }

    await oferta.save();
    return res.json({ guardados: oferta.guardados });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al guardar promoción", error: safeErr(error) });
  }
};

// 🔸 Aumentar visualización (una por visita)
const contarVisualizacion = async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ mensaje: "ID de promoción inválido" });
  }

  try {
    const updated = await Oferta.findByIdAndUpdate(id, { $inc: { visualizaciones: 1 } });
    if (!updated) return res.status(404).json({ mensaje: "Promoción no encontrada" });
    return res.json({ mensaje: "Visualización registrada" });
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al contar visualización", error: safeErr(error) });
  }
};

// 🔸 Obtener detalles de una promoción
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
    return res.json(oferta);
  } catch (error) {
    return res.status(500).json({ mensaje: "Error al obtener promoción", error: safeErr(error) });
  }
};

module.exports = {
  reaccionarPromocion,
  guardarPromocion,
  contarVisualizacion,
  obtenerPromocionPorId,
};
