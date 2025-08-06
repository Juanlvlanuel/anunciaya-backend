// ✅ controllers/promocionesController.js

const Oferta = require("../models/Oferta");

// 🔸 Agregar o alternar reacción (like/love)
const reaccionarPromocion = async (req, res) => {
  const { id } = req.params;
  const { usuarioId, tipo } = req.body;

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

    const existente = oferta.likes.find((r) => r.usuario.toString() === usuarioId);
    if (existente) {
      if (existente.tipo === tipo) {
        oferta.likes = oferta.likes.filter((r) => r.usuario.toString() !== usuarioId);
      } else {
        existente.tipo = tipo;
      }
    } else {
      oferta.likes.push({ usuario: usuarioId, tipo });
    }

    await oferta.save();
    res.json({ likes: oferta.likes });
  } catch (error) {
    res.status(500).json({ mensaje: "Error al reaccionar", error });
  }
};

// 🔸 Guardar o desguardar promoción
const guardarPromocion = async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const oferta = await Oferta.findById(id);
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });

    const yaGuardado = oferta.guardados.includes(usuarioId);
    if (yaGuardado) {
      oferta.guardados = oferta.guardados.filter((u) => u.toString() !== usuarioId);
    } else {
      oferta.guardados.push(usuarioId);
    }

    await oferta.save();
    res.json({ guardados: oferta.guardados });
  } catch (error) {
    res.status(500).json({ mensaje: "Error al guardar promoción", error });
  }
};

// 🔸 Aumentar visualización (una por visita)
const contarVisualizacion = async (req, res) => {
  const { id } = req.params;

  try {
    await Oferta.findByIdAndUpdate(id, { $inc: { visualizaciones: 1 } });
    res.json({ mensaje: "Visualización registrada" });
  } catch (error) {
    res.status(500).json({ mensaje: "Error al contar visualización", error });
  }
};

// 🔸 Obtener detalles de una promoción
const obtenerPromocionPorId = async (req, res) => {
  const { id } = req.params;

  try {
    const oferta = await Oferta.findById(id)
      .populate("creador", "nombre")
      .populate("comentarios.usuario", "nombre");
    if (!oferta) return res.status(404).json({ mensaje: "Promoción no encontrada" });
    res.json(oferta);
  } catch (error) {
    res.status(500).json({ mensaje: "Error al obtener promoción", error });
  }
};

module.exports = {
  reaccionarPromocion,
  guardarPromocion,
  contarVisualizacion,
  obtenerPromocionPorId,
};
