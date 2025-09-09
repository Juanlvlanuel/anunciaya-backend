// controllers/profileController-1.js
// Seleccionar perfil, actualizar perfil (con ciudad) y gestionar nickname (actualizar + verificación de unicidad).

const Usuario = require("../models/Usuario");

const norm = (v) => {
  if (v === undefined || v === null) return "";
  return String(v).trim();
};

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

/* ===================== ACTUALIZAR PERFIL =====================
 *  - Soporta `ciudad` como alias de `direccion` (compatibilidad).
 *  - Permite nombre, telefono y fotoPerfil.
 */
const actualizarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id || req.usuarioId;
    if (!usuarioId) return res.status(401).json({ mensaje: "No autenticado" });

    const allowed = ["nombre", "telefono", "fotoPerfil", "direccion", "ciudad", "nickname", "twoFactorEnabled"];
    const updates = {};
    for (const k of allowed) {
      if (k in req.body) {
        if (k === "ciudad") {
          updates["direccion"] = req.body[k];
        } else if (k === "twoFactorEnabled") {
          // ✅ Forzar a booleano: true si llega "true" o true
          updates[k] = req.body[k] === true || req.body[k] === "true";
        } else {
          updates[k] = req.body[k];
        }
      }
    }

    console.log("BODY:", req.body);
    console.log("UPDATES:", updates);

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

/* ===================== ACTUALIZAR NICKNAME =====================
 * - Endpoint: PATCH /api/usuarios/me/nickname
 * - Valida unicidad y evita colisión con otros usuarios.
 */
const actualizarNickname = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id || req.usuarioId;
    if (!usuarioId) return res.status(401).json({ mensaje: "No autenticado" });

    const raw = String(req.body?.nickname || "").trim();
    if (!raw) return res.status(400).json({ mensaje: "Nickname requerido" });

    // Verificar si ya existe y no es del propio usuario
    const existente = await Usuario.findOne({ nickname: raw }).select("_id nickname");
    if (existente && String(existente._id) !== String(usuarioId)) {
      return res.status(409).json({ mensaje: "Nickname ya en uso" });
    }

    const opts = { new: true, runValidators: true };
    const actualizado = await Usuario.findByIdAndUpdate(
      usuarioId,
      { $set: { nickname: raw } },
      opts
    ).lean();
    if (!actualizado) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    return res.json({ mensaje: "Nickname actualizado", usuario: actualizado });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("actualizarNickname:", e);
    return res.status(500).json({ mensaje: "Error al actualizar nickname" });
  }
};

/* ===================== CHECK NICKNAME (UNICIDAD) =====================
 * - Endpoint: GET /api/usuarios/nickname/check?nickname=<nick>&exclude=<userId>
 * - Respuesta: { exists: boolean, userId?: string }
 * - No requiere autenticación; `exclude` permite excluir el propio ID.
 */
const checkNickname = async (req, res) => {
  try {
    const nick = norm(req.query?.nickname || req.query?.nick);
    if (!nick) return res.status(400).json({ mensaje: "Nickname requerido" });

    const exclude = String(req.query?.exclude || req.usuario?._id || req.usuarioId || "");

    const existente = await Usuario.findOne({ nickname: nick }).select("_id nickname").lean();
    const exists = !!existente && String(existente._id) !== String(exclude || "");

    return res.json({ exists, userId: existente ? String(existente._id) : null });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("checkNickname:", e);
    return res.status(500).json({ mensaje: "Error al verificar nickname" });
  }
};

module.exports = { seleccionarPerfil, actualizarPerfil, actualizarNickname, checkNickname };
