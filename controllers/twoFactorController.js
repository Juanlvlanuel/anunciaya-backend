const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const Usuario = require("../models/Usuario");
const bcrypt = require("bcryptjs");
const { sendMail } = require("../utils/mailer");

/**
 * Memoria temporal para OTP de reset 2FA.
 * Nota: si el servidor reinicia, los OTPs se pierden (válidos por 10 min).
 */
const resetStore = new Map(); // key: correo (lower), value: { uid, otp, exp: ms }

function genOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function putOTP(correo, uid) {
  const otp = genOTP();
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutos
  resetStore.set(String(correo).toLowerCase(), { uid: String(uid), otp, exp });
  return otp;
}

function takeIfValid(correo, otp) {
  const key = String(correo).toLowerCase();
  const rec = resetStore.get(key);
  if (!rec) return null;
  if (Date.now() > rec.exp) {
    resetStore.delete(key);
    return null;
  }
  if (String(rec.otp) !== String(otp)) return null;
  resetStore.delete(key);
  return rec;
}

// ==== Rate limit por usuario (memoria) ====
const attemptStore = new Map(); // key -> { count, reset }

function touchAttempt(key, windowMs = 5 * 60 * 1000) {
  const now = Date.now();
  const rec = attemptStore.get(key);
  if (!rec || now > rec.reset) {
    const fresh = { count: 1, reset: now + windowMs };
    attemptStore.set(key, fresh);
    return fresh;
  }
  rec.count += 1;
  return rec;
}
function remainingMs(key) {
  const rec = attemptStore.get(key);
  return rec ? Math.max(0, rec.reset - Date.now()) : 0;
}
function clearAttempts(key) {
  attemptStore.delete(key);
}

// ===== Helpers backup codes =====
function randomCode() {
  // 8 alfanuméricos con guion (ej. AB7K-9Q3M)
  const dict = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0,1,IO
  const mk = (n) => Array.from({ length: n }, () => dict[Math.floor(Math.random() * dict.length)]).join("");
  return `${mk(4)}-${mk(4)}`;
}

async function hashCodes(codes) {
  const out = [];
  for (const c of codes) {
    const hash = await bcrypt.hash(c, 10);
    out.push({ hash, usedAt: null });
  }
  return out;
}

/**
 * GET /api/usuarios/2fa/setup
 * - Genera secreto y deja pending_setup (enabled=false, confirmed=false)
 */
exports.generarSetup = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    // ⛔️ Blindaje: si ya está activo y confirmado, no permitir regenerar aquí
    const current = await Usuario.findById(uid)
      .select("twoFactorEnabled twoFactorConfirmed twoFactorSecret")
      .lean();
    if (current && current.twoFactorEnabled && current.twoFactorConfirmed) {
      return res.status(409).json({
        mensaje: "2FA ya está activo. Usa 'Reconfigurar 2FA' si perdiste tu app."
      });
    }

    const secret = speakeasy.generateSecret({ length: 20, name: "AnunciaYA", issuer: "AnunciaYA" });

    await Usuario.findByIdAndUpdate(uid, {
      $set: { twoFactorSecret: secret.base32, twoFactorConfirmed: false, twoFactorEnabled: false },
    });

    const otpauth = secret.otpauth_url;
    const qr = await qrcode.toDataURL(otpauth);
    return res.json({ otpauth, qr });
  } catch (err) {
    return res.status(500).json({ mensaje: "Error generando QR" });
  }
};

/**
 * POST /api/usuarios/2fa/verificar  { codigo }
 * - Verifica TOTP; si ok → confirmed=true, enabled=true
 */
exports.verificarCodigo = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    const { codigo } = req.body || {};
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
    if (!codigo) return res.status(400).json({ mensaje: "Código requerido" });

    // Rate limit: máximo 5 intentos por 5 min por usuario
    const k = `totp:${uid}`;
    const rec = touchAttempt(k, 5 * 60 * 1000);
    if (rec.count > 5) {
      const ms = remainingMs(k);
      return res.status(429).json({
        mensaje: `Demasiados intentos. Intenta en ${Math.ceil(ms / 1000)}s`
      });
    }

    const usuario = await Usuario.findById(uid).select("+twoFactorSecret");
    if (!usuario || !usuario.twoFactorSecret) {
      return res.status(400).json({ mensaje: "2FA no configurado" });
    }

    const ok = speakeasy.totp.verify({
      secret: usuario.twoFactorSecret,
      encoding: "base32",
      token: String(codigo),
      window: 1,
    });
    if (!ok) return res.status(401).json({ mensaje: "Código inválido" });

    console.log("✅ Verificado con éxito:", uid);

    const id = typeof uid === "string" ? Types.ObjectId(uid) : uid;

    const result = await Usuario.updateOne(
      { _id: uid },
      {
        $set: {
          twoFactorConfirmed: true,
          twoFactorEnabled: true,
        },
      },
      { runValidators: false, strict: false }
    );

    clearAttempts(k);

    return res.json({ mensaje: "2FA activado con éxito" });
  } catch (err) {
    return res.status(500).json({ mensaje: "Error verificando código" });
  }
};

/**
 * POST /api/usuarios/2fa/desactivar
 * - Limpia por completo el estado de 2FA del usuario
 */
exports.desactivar2FA = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    // ✅ Verificación: contraseña O TOTP (6 dígitos)
    const pwd = String(req.body?.password || req.body?.contraseña || "").trim();
    const totp = String(req.body?.totp || req.body?.codigo || "").trim();

    // Trae lo necesario para verificar
    const user = await Usuario.findById(uid).select("+contraseña +twoFactorSecret +twoFactorConfirmed");
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    let verified = false;

    // a) Si enviaron contraseña y el usuario tiene una, intenta verificar
    if (pwd) {
      try {
        verified = await (typeof user.comprobarPassword === "function"
          ? user.comprobarPassword(pwd)
          : false);
      } catch { }
    }

    // b) Si no pasó por contraseña, permite verificar con TOTP válido
    if (!verified && totp && user.twoFactorSecret) {
      try {
        verified = require("speakeasy").totp.verify({
          secret: user.twoFactorSecret,
          encoding: "base32",
          token: String(totp),
          window: 1,
        });
      } catch { }
    }

    if (!verified) {
      return res.status(401).json({ mensaje: "Verificación requerida (contraseña o código 2FA válido)" });
    }

    // Desactivar 2FA
    await Usuario.findByIdAndUpdate(uid, {
      $set: {
        twoFactorEnabled: false,
        twoFactorConfirmed: false,
        twoFactorSecret: null,
      },
    });

    return res.json({ mensaje: "2FA desactivado" });
  } catch (err) {
    return res.status(500).json({ mensaje: "Error desactivando 2FA" });
  }
};


/**
 * === RESET SEGURO (sin sesión): "Perdí mi app" ===
 */

/**
 * POST /api/usuarios/2fa/reset/start  { email, password }
 * - Verifica credenciales básicas (correo + contraseña)
 * - Envía OTP por correo (6 dígitos, 10 minutos)
 */
exports.resetStart = async (req, res) => {
  try {
    const email = String(req.body?.email || req.body?.correo || "").trim().toLowerCase();
    const password = String(req.body?.password || req.body?.contraseña || "").trim();
    if (!email || !password) return res.status(400).json({ mensaje: "Correo y contraseña requeridos" });

    const user = await Usuario.findOne({ correo: email }).select("+contraseña +twoFactorEnabled");
    if (!user) return res.status(404).json({ mensaje: "No existe una cuenta con este correo" });

    const ok = await (typeof user.comprobarPassword === "function" ? user.comprobarPassword(password) : Promise.resolve(false));
    if (!ok) return res.status(401).json({ mensaje: "Credenciales inválidas" });

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ mensaje: "Tu cuenta no tiene 2FA activo" });
    }

    const otp = putOTP(email, user._id);
    try {
      await sendMail({
        to: email,
        subject: "Código para reconfigurar tu 2FA (AnunciaYA)",
        text: `Tu código es: ${otp}
Es válido por 10 minutos.
Si no solicitaste este código, ignora este correo.`,
      });
    } catch (e) {
      return res.status(500).json({ mensaje: "No se pudo enviar el código. Intenta más tarde." });
    }
    return res.json({ mensaje: "Código enviado a tu correo" });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error iniciando reset de 2FA" });
  }
};

/**
 * POST /api/usuarios/2fa/reset/verify  { email, otp }
 * - Verifica OTP y desactiva 2FA (secret=null, flags=false)
 */
exports.resetVerify = async (req, res) => {
  try {
    const email = String(req.body?.email || req.body?.correo || "").trim().toLowerCase();
    const otp = String(req.body?.otp || req.body?.codigo || "").trim();
    if (!email || !otp) return res.status(400).json({ mensaje: "Correo y código requeridos" });

    const rec = takeIfValid(email, otp);
    if (!rec) return res.status(400).json({ mensaje: "Código inválido o expirado" });

    await Usuario.findByIdAndUpdate(rec.uid, {
      $set: { twoFactorEnabled: false, twoFactorConfirmed: false, twoFactorSecret: null },
    });

    return res.json({ mensaje: "2FA desactivado. Puedes iniciar sesión y reconfigurarlo." });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error verificando código" });
  }
};


/**
 * POST /api/usuarios/2fa/backup/generate
 *  - Requiere sesión (verificarToken)
 *  - Genera 10 códigos y los devuelve en claro (solo esta vez)
 */
exports.generateBackupCodes = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const user = await Usuario.findById(uid).select("+twoFactorSecret");
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });
    if (!user.twoFactorConfirmed) {
      return res.status(400).json({ mensaje: "Activa y confirma 2FA antes de generar códigos" });
    }

    const plain = Array.from({ length: 10 }, () => randomCode());
    const hashed = await hashCodes(plain);

    user.backupCodes = hashed;
    await user.save();

    return res.json({ codes: plain });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error generando códigos de respaldo" });
  }
};

/**
 * POST /api/usuarios/2fa/backup/regenerate
 *  - Requiere sesión (verificarToken)
 *  - Invalida anteriores y genera 10 nuevos
 */
exports.regenerateBackupCodes = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    // 🔒 Validar identidad: contraseña O TOTP actual
    const pwd = String(req.body?.password || req.body?.contraseña || "").trim();
    const totp = String(req.body?.totp || req.body?.codigo || "").trim();

    const user = await Usuario.findById(uid).select("+contraseña +twoFactorSecret +twoFactorConfirmed");
    if (!user) return res.status(404).json({ mensaje: "Usuario no encontrado" });

    let verified = false;

    // a) Si envían contraseña y el usuario tiene una:
    if (pwd) {
      try {
        verified = await (typeof user.comprobarPassword === "function"
          ? user.comprobarPassword(pwd)
          : false);
      } catch { }
    }

    // b) Si no hay contraseña válida, aceptar TOTP (6 dígitos) actual:
    if (!verified && totp && user.twoFactorSecret) {
      try {
        verified = require("speakeasy").totp.verify({
          secret: user.twoFactorSecret,
          encoding: "base32",
          token: String(totp),
          window: 1,
        });
      } catch { }
    }

    if (!verified) {
      return res.status(401).json({ mensaje: "Verificación requerida (contraseña o código 2FA válido)" });
    }

    if (!user.twoFactorConfirmed) {
      return res.status(400).json({ mensaje: "Activa y confirma 2FA antes de regenerar" });
    }

    // Generar nuevos códigos
    const plain = Array.from({ length: 10 }, () => randomCode());
    const hashed = await hashCodes(plain);

    user.backupCodes = hashed;
    await user.save();

    return res.json({ codes: plain });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error regenerando códigos" });
  }
};



/**
 * POST /api/usuarios/2fa/backup/use
 *  - SIN sesión
 *  - Body: { email, password, code }
 *  - Verifica credenciales + consume un backup code válido (marca usedAt)
 *  - Como atajo seguro: desactiva 2FA para permitir acceso y reconfigurar
 */
exports.useBackupCode = async (req, res) => {
  try {
    const email = String(req.body?.email || req.body?.correo || "").trim().toLowerCase();
    const password = String(req.body?.password || req.body?.contraseña || "").trim();
    const code = String(req.body?.code || req.body?.backupCode || "").trim().toUpperCase();
    if (!email || !password || !code) {
      return res.status(400).json({ mensaje: "Correo, contraseña y código requeridos" });
    }

    // Rate limit: máximo 5 intentos por email/5 min
    const keyUse = `backup:${email}`;
    const recUse = touchAttempt(keyUse, 5 * 60 * 1000);
    if (recUse.count > 5) {
      const ms = remainingMs(keyUse);
      return res.status(429).json({ mensaje: `Demasiados intentos. Intenta en ${Math.ceil(ms / 1000)}s` });
    }

    const user = await Usuario.findOne({ correo: email }).select("+contraseña");
    if (!user) return res.status(404).json({ mensaje: "No existe una cuenta con este correo" });

    const ok = await (typeof user.comprobarPassword === "function" ? user.comprobarPassword(password) : Promise.resolve(false));
    if (!ok) return res.status(401).json({ mensaje: "Credenciales inválidas" });

    // Buscar un backupCode válido (no usado)
    const list = Array.isArray(user.backupCodes) ? user.backupCodes : [];
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item && !item.usedAt) {
        const match = await bcrypt.compare(code, item.hash);
        if (match) { idx = i; break; }
      }
    }
    if (idx === -1) return res.status(400).json({ mensaje: "Código inválido o ya usado" });

    // Consumir y desactivar 2FA (para permitir acceso y reconfigurar)
    user.backupCodes[idx].usedAt = new Date();
    user.twoFactorEnabled = false;
    user.twoFactorConfirmed = false;
    user.twoFactorSecret = null;
    await user.save();

    clearAttempts(keyUse);

    return res.json({ mensaje: "Código aceptado. 2FA desactivado. Inicia sesión y reconfigura tu 2FA." });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error usando código de respaldo" });
  }
};
