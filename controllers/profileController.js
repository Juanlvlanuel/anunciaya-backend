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

/* ===================== ELIMINAR CUENTA =====================
 * - Endpoint: DELETE /api/usuarios/me
 * - Mueve la cuenta a CuentasEliminadas y luego la elimina de Usuarios
 */
const CuentaEliminada = require("../models/CuentaEliminada");

const eliminarCuenta = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const user = await Usuario.findById(uid).lean();
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    await CuentaEliminada.create({
      originalId: user._id,
      datos: user,
    });

    await Usuario.findByIdAndDelete(uid);

    try {
      res.clearCookie("rid", {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api",
      });
    } catch {}

    return res.status(200).json({ ok: true, mensaje: "Cuenta eliminada" });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("eliminarCuenta:", e);
    return res.status(500).json({ mensaje: "Error al eliminar cuenta" });
  }
};


/* ===================== RECUPERAR CUENTA =====================
 * - Endpoint: POST /api/usuarios/recuperar
 * - Busca en cuentas_eliminadas y restaura si no existe ya
 */
const { signAccess, signRefresh } = require("../helpers/tokens");
const { setRefreshCookie } = require("./_usuario.shared");

const recuperarCuenta = async (req, res) => {
  try {
    const correo = String(req.body?.correo || "").trim().toLowerCase();
    if (!correo) return res.status(400).json({ mensaje: "Correo requerido" });

    const existente = await Usuario.findOne({ correo }).lean();
    if (existente) {
      return res.status(409).json({ mensaje: "Ya existe una cuenta activa con este correo." });
    }

    const eliminada = await CuentaEliminada.findOne({ "datos.correo": correo });
    if (!eliminada) {
      return res.status(404).json({ mensaje: "No se encontró cuenta eliminada con ese correo." });
    }

    const nueva = await Usuario.create(eliminada.datos);
    await CuentaEliminada.deleteOne({ _id: eliminada._id });

    const token = signAccess(nueva._id);
    const { refresh } = await signRefresh(nueva._id);
    setRefreshCookie(req, res, refresh);

    return res.json({
      mensaje: "Cuenta recuperada",
      token,
      usuario: {
        _id: nueva._id,
        nombre: nueva.nombre,
        correo: nueva.correo,
        tipo: nueva.tipo,
        perfil: nueva.perfil,
      },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("recuperarCuenta:", e);
    return res.status(500).json({ mensaje: "Error al recuperar cuenta" });
  }
};


module.exports = { seleccionarPerfil, actualizarPerfil, actualizarNickname, checkNickname,eliminarCuenta,recuperarCuenta };
