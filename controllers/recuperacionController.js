const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");
const CuentaEliminada = require("../models/CuentaEliminada");
const Usuario = require("../models/Usuario");
const { signAccess, signRefresh } = require("../helpers/tokens");
const { setRefreshCookie } = require("./_usuario.shared");

// Validación básica de contraseña
function strongEnough(pwd = "") {
  return typeof pwd === "string" &&
    pwd.length >= 8 &&
    /[a-z]/.test(pwd) &&
    /[A-Z]/.test(pwd) &&
    /[0-9]/.test(pwd);
}

// === POST /api/usuarios/recuperar/enviar-codigo
async function enviarCodigoRecuperacion(req, res) {
  try {
    const correo = (req.body?.correo || "").toLowerCase().trim();
    if (!correo) return res.status(400).json({ mensaje: "Correo requerido" });

    const doc = await CuentaEliminada.findOne({ "datos.correo": correo }).lean();
    if (!doc) {
      console.warn("⚠️ CuentaEliminada no encontrada para:", correo);
      return res.status(404).json({ mensaje: "No se encontró una cuenta eliminada con ese correo." });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expira = new Date(Date.now() + 15 * 60 * 1000);

    const result = await CuentaEliminada.updateOne(
      { _id: doc._id },
      { $set: { recoveryCode: codigo, recoveryCodeExpira: expira } },
      { strict: false } // 🔒 forzar escritura aún si no están en el schema
    );
    console.log("👉 Resultado updateOne:", result);

    const subject = "Código de recuperación de tu cuenta en AnunciaYA";
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial">
        <h2>Recuperación de cuenta</h2>
        <p>Tu código para recuperar tu cuenta es:</p>
        <p style="font-size: 24px; font-weight: bold;">${codigo}</p>
        <p>Este código expirará en 15 minutos.</p>
      </div>`;

    await sendMail({
      to: correo,
      subject,
      html,
      from: process.env.EMAIL_FROM || "no-reply@anunciaya.com",
    });

    return res.json({ mensaje: "Código enviado al correo" });
  } catch (e) {
    console.error("❌ Error al enviar código de recuperación:", e);
    return res.status(500).json({ mensaje: "Error al enviar código" });
  }
}

// === POST /api/usuarios/recuperar/verificar-codigo
async function verificarCodigoRecuperacion(req, res) {
  try {
    const correo = (req.body?.correo || "").toLowerCase().trim();
    const codigo = (req.body?.codigo || "").trim();
    const nueva = (req.body?.contraseña || req.body?.password || "").trim();

    if (!correo || !codigo || !nueva) {
      return res.status(400).json({ mensaje: "Faltan datos" });
    }

    if (!strongEnough(nueva)) {
      return res.status(400).json({ mensaje: "Contraseña insegura. Usa mínimo 8 caracteres con mayúscula, minúscula y número." });
    }

    const doc = await CuentaEliminada.findOne({ "datos.correo": correo }).lean();
    if (!doc || !doc.recoveryCode || !doc.recoveryCodeExpira) {
      return res.status(404).json({ mensaje: "No se encontró cuenta pendiente de recuperación." });
    }

    if (doc.recoveryCode !== codigo) {
      return res.status(400).json({ mensaje: "Código incorrecto." });
    }

    if (new Date(doc.recoveryCodeExpira) < new Date()) {
      return res.status(400).json({ mensaje: "El código ha expirado." });
    }

    const datos = { ...doc.datos, contraseña: nueva };
    delete datos._id;
    datos.twoFactorEnabled = false;
    delete datos.twoFactorSecret;
    delete datos.twoFactorConfirmed;

    const nuevaCuenta = await Usuario.create(datos);
    await CuentaEliminada.deleteOne({ _id: doc._id });

    const token = signAccess(nuevaCuenta._id);
    const { refresh } = await signRefresh(nuevaCuenta._id);
    setRefreshCookie(req, res, refresh);

    return res.json({
      mensaje: "Cuenta recuperada con éxito",
      token,
      usuario: {
        _id: nuevaCuenta._id,
        nombre: nuevaCuenta.nombre,
        correo: nuevaCuenta.correo,
        tipo: nuevaCuenta.tipo,
        perfil: nuevaCuenta.perfil,
      },
    });
  } catch (e) {
    console.error("❌ Error al verificar código:", e);
    return res.status(500).json({ mensaje: "Error al verificar código" });
  }
}

module.exports = {
  enviarCodigoRecuperacion,
  verificarCodigoRecuperacion
};