import Admin from "../models/Admin.js";

/**
 * Login de administrador con validación, sanitización y manejo de errores uniforme.
 * Mantiene la lógica original y el token fijo (placeholder), listo para migrar a JWT si lo decides.
 */
export const loginAdmin = async (req, res) => {
  try {
    // 🧼 Sanitización y validación
    const usuario = (req.body?.usuario ?? "").toString().trim();
    const contraseña = (req.body?.contraseña ?? "").toString();

    if (!usuario || !contraseña) {
      return res.status(400).json({ msg: "Faltan credenciales: usuario y contraseña son obligatorios" });
    }
    if (usuario.length < 3 || usuario.length > 64) {
      return res.status(400).json({ msg: "Usuario inválido" });
    }
    if (contraseña.length < 6 || contraseña.length > 128) {
      return res.status(400).json({ msg: "Contraseña inválida" });
    }

    // 🔎 Buscar admin
    const admin = await Admin.findOne({ usuario });
    if (!admin) {
      return res.status(401).json({ msg: "Usuario o contraseña incorrectos" });
    }

    // 🔐 Comparar contraseña
    const esCorrecto = await admin.compararPassword(contraseña);
    if (!esCorrecto) {
      return res.status(401).json({ msg: "Usuario o contraseña incorrectos" });
    }

    // ✅ Éxito → devolver datos básicos (sin exponer sensibles)
    return res.json({
      _id: admin._id,
      usuario: admin.usuario,
      token: "autorizado123",
    });
  } catch (_err) {
    return res.status(500).json({ msg: "Error del servidor" });
  }
};
