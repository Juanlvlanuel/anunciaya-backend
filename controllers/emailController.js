// controllers/emailController-1.js
const crypto = require("crypto");
const Usuario = require("../models/Usuario");
const { sendMail } = require("../utils/mailer");

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
    if (userId) {
      try { user = await Usuario.findById(userId).lean(); } catch {}
    }
    if (!user && correo) {
      user = await Usuario.findOne({ correo }).lean();
    }
    if (!user && req.user && req.user.uid) {
      user = await Usuario.findById(req.user.uid).lean();
    }
    if (!user) {
      return res.status(404).json({ mensaje: "Usuario no encontrado" });
    }
    if (user.emailVerificado) {
      return res.json({ mensaje: "Correo ya verificado" });
    }

    const raw = crypto.randomBytes(32).toString("hex");
    const hashed = hashToken(raw);
    const expMs = parseInt(process.env.EMAIL_VERIFY_TTL_MS || String(24 * 60 * 60 * 1000), 10);

    await Usuario.updateOne(
      { _id: user._id },
      {
        $set: {
          emailVerificationToken: hashed,
          emailVerificationExpires: new Date(Date.now() + (isFinite(expMs) ? expMs : 86400000)),
          emailVerificado: false,
        },
      }
    );

    const verifyUrl = `${frontendBase()}/verificar-email?token=${encodeURIComponent(raw)}`;

    const from = process.env.EMAIL_FROM || "no-reply@anunciaya.com";
    const subject = "Verifica tu correo en AnunciaYA";
    const text = `Hola ${user.nombre || ""}:\n\nConfirma tu correo haciendo clic en este enlace:\n${verifyUrl}\n\nSi no creaste una cuenta, ignora este mensaje.`;
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.6">
        <h2>Confirma tu correo</h2>
        <p>Hola ${user.nombre || ""},</p>
        <p>Para activar tu cuenta, verifica tu correo haciendo clic en el siguiente botón:</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none">Verificar correo</a></p>
        <p>O copia y pega este enlace en tu navegador:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p style="color:#64748b;font-size:12px">Este enlace expira en 24 horas.</p>
      </div>`;

    try {
      await sendMail({ to: user.correo, from, subject, text, html });
    } catch (e) {
      return res.status(500).json({
        mensaje: "No se pudo enviar el correo de verificación",
        error: { code: e.code || null, message: e.message || null }
      });
    }

    return res.json({ mensaje: "Correo de verificación enviado" });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al reenviar verificación", detalle: e.message });
  }
}

/**
 * GET /api/usuarios/verificar-email?token=...
 */
async function verifyEmail(req, res) {
  try {
    const raw = (req.query && req.query.token) || (req.params && req.params.token) || "";
    if (!raw || String(raw).length < 20) {
      return res.status(400).json({ mensaje: "Token faltante o inválido" });
    }
    const hashed = hashToken(raw);
    const now = new Date();

    const user = await Usuario.findOne({
      emailVerificationToken: hashed,
      emailVerificationExpires: { $gt: now },
    });
    if (!user) {
      return res.status(400).json({ mensaje: "Token inválido o expirado" });
    }

    user.emailVerificado = true;
    user.emailVerificadoAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save({ validateModifiedOnly: true });

    return res.json({ ok: true, mensaje: "Correo verificado", usuario: user });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error verificando correo", detalle: e.message });
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

module.exports = { requestVerificationEmail, verifyEmail, testSMTP };
