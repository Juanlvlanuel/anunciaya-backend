// controllers/emailController-1.js
const crypto = require("crypto");
const Usuario = require("../models/Usuario");
const { sendMail } = require("../utils/mailer");
const { signAccess, signRefresh } = require("../helpers/tokens");
const { setRefreshCookie } = require("./_usuario.shared");


function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function frontendBase() {
  const raw =
    process.env.FRONTEND_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173";
  return String(raw).replace(/\/+$/, "");
}

/**
 * POST /api/usuarios/reenviar-verificacion
 */
async function requestVerificationEmail(req, res) {
  try {
    const body = req.body || {};
    const userId = body.userId || body.uid || null;
    const correo = (body.correo || body.email || "").toString().trim().toLowerCase();

    let user = null;
    if (userId) user = await Usuario.findById(userId);
    if (!user && correo) user = await Usuario.findOne({ correo });
    if (!user && req.user && req.user.uid) user = await Usuario.findById(req.user.uid);
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    if (user.emailVerificado) {
      return res.json({ mensaje: "Correo ya verificado" });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
    const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    user.codigoVerificacionEmail = codigo;
    user.codigoVerificacionExpira = expira;
    await user.save({ validateModifiedOnly: true });

    const from = process.env.EMAIL_FROM || "no-reply@anunciaya.com";
    const subject = "Tu código de verificación en AnunciaYA";
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.6">
        <h2>Código de verificación</h2>
        <p>Hola ${user.nombre || ""},</p>
        <p>Tu código para verificar tu correo es:</p>
        <p style="font-size: 24px; font-weight: bold;">${codigo}</p>
        <p>Este código expirará en 15 minutos.</p>
        <p>Si no creaste una cuenta, puedes ignorar este mensaje.</p>
      </div>`;

    await sendMail({ to: user.correo, from, subject, html });

    return res.json({ mensaje: "Código de verificación enviado" });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al reenviar verificación", detalle: e.message });
  }
}



/**
 * GET /api/usuarios/auth/test-smtp?to=correo
 * Prueba rápida para verificar envío SMTP
 */
async function testSMTP(req, res) {
  try {
    const to = (req.query.to || "").toString().trim();
    if (!to) return res.status(400).json({ mensaje: "Falta parámetro ?to=correo" });

    const subject = "Prueba SMTP desde AnunciaYA";
    const text = "Este es un correo de prueba para confirmar que la configuración SMTP funciona.";
    await sendMail({ to, from: process.env.EMAIL_FROM, subject, text });

    return res.json({ ok: true, mensaje: `Correo de prueba enviado a ${to}` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: { code: e.code || null, message: e.message || e.toString() } });
  }
}

async function verificarCodigo6dig(req, res) {
  try {
    const { correo, codigo } = req.body || {};
    const email = (correo || "").toString().trim().toLowerCase();
    const cod = (codigo || "").toString().trim();

    if (!email || !cod || cod.length !== 6) {
      return res.status(400).json({ mensaje: "Correo o código inválido" });
    }

    const user = await Usuario.findOne({ correo: email }).select("+codigoVerificacionEmail +codigoVerificacionExpira");
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    const now = new Date();
    if (!user.codigoVerificacionEmail || !user.codigoVerificacionExpira || user.codigoVerificacionExpira < now) {
      return res.status(400).json({ mensaje: "Código expirado o inválido" });
    }

    if (user.codigoVerificacionEmail !== cod) {
      return res.status(400).json({ mensaje: "Código incorrecto" });
    }

    user.emailVerificado = true;
    user.emailVerificadoAt = new Date();
    user.codigoVerificacionEmail = null;
    user.codigoVerificacionExpira = null;

    // ✅ Guardar cambios en Mongo
    await user.save({ validateModifiedOnly: true });

    const token = signAccess(user._id);
    const { refresh } = await signRefresh(user._id);
    setRefreshCookie(req, res, refresh);

    return res.json({
      mensaje: "Correo verificado con éxito",
      ok: true,
      token,
      usuario: user,
    });

  } catch (e) {
    return res.status(500).json({ mensaje: "Error al verificar código", detalle: e.message });
  }
}


module.exports = { requestVerificationEmail, verificarCodigo6dig, testSMTP };
