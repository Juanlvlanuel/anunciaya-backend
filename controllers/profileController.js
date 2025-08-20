// controllers/profileController.js
// Seleccionar perfil y actualizar perfil.

const { Usuario, norm } = require("./_usuario.shared");

/* ===================== SELECCIONAR PERFIL ===================== */
const seleccionarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id || req.usuarioId;
    const perfil = norm(req.body?.perfil);

    if (!perfil) {
      return res.status(400).json({ mensaje: "Perfil no especificado" });
    }

    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ mensaje: "Usuario no Encontrado" });
    }

    usuario.perfil = perfil;
    await usuario.save();

    return res.status(201).json({ mensaje: "Perfil Actualizado", perfil: usuario.perfil });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error al actualizar Perfil:", error?.message || error);
    }
    return res.status(500).json({ mensaje: "Error al actualizar Perfil" });
  }
};

// ===================== ACTUALIZAR PERFIL =====================
const actualizarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id || req.usuarioId;
    if (!usuarioId) return res.status(401).json({ mensaje: "No autenticado" });

    const allowed = ["nombre", "telefono", "direccion", "fotoPerfil"];
    const updates = {};
    for (const k of allowed) {
      if (k in req.body) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ mensaje: "Nada para actualizar" });
    }

    const opts = { new: true, runValidators: true };
    const actualizado = await Usuario.findByIdAndUpdate(usuarioId, { $set: updates }, opts).lean();
    if (!actualizado) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    return res.json({ mensaje: "Perfil actualizado", usuario: actualizado });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("actualizarPerfil:", e);
    return res.status(500).json({ mensaje: "Error al actualizar perfil" });
  }
};

module.exports = { seleccionarPerfil, actualizarPerfil };
