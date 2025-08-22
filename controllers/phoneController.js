// controllers/phoneController-1.js (MX WhatsApp: fuerza +521 incluso si el input ya trae +52)
const crypto = require("crypto");
const PhoneOTP = require("../models/PhoneOTP");
const Usuario = require("../models/Usuario");
const { sendSMS, sendWhatsApp, sendVoice } = require("../utils/notify");

const OTP_LEN = parseInt(process.env.PHONE_OTP_LEN || "6", 10);
const OTP_TTL_SEC = parseInt(process.env.PHONE_OTP_TTL_SEC || "600", 10); // 10 min
const RESEND_COOLDOWN_MS = parseInt(process.env.PHONE_RESEND_COOLDOWN_MS || "90000", 10); // 1:30
const DEFAULT_COUNTRY = (process.env.PHONE_DEFAULT_COUNTRY || "MX").toUpperCase();

function hash(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function digits(s=""){ return String(s).replace(/\D+/g,""); }

function normalizePhone(raw, { canal = "whatsapp" } = {}) {
  let val = String(raw || "").trim();
  if (!val) return "";
  // quitar prefijo whatsapp: si viene
  if (/^whatsapp:/i.test(val)) val = val.replace(/^whatsapp:/i, "");

  const d = digits(val);

  // Caso especial MX para WhatsApp: siempre +521 + 10 dígitos
  if (DEFAULT_COUNTRY === "MX" && canal === "whatsapp") {
    // Si ya viene con +52 y 10 dígitos => convertir a +521
    if (/^\+52\d{10}$/.test(val)) return `+521${d.slice(-10)}`;
    // Si viene sin + => 10 dígitos
    if (/^\d{10}$/.test(d)) return `+521${d}`;
    // Si viene con 521 y 10 dígitos (con o sin +) => normalizar a +521
    if (/^(\+?521)\d{10}$/.test(val)) return `+521${d.slice(-10)}`;
  }

  // SMS/otros o países no MX: E.164 genérico
  if (val.startsWith("+")) return val;
  if (DEFAULT_COUNTRY === "MX") {
    if (canal !== "whatsapp" && /^\d{10}$/.test(d)) return `+52${d}`;
  }
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return val;
}

function pickChannel(s) {
  const c = String(s || "whatsapp").toLowerCase();
  return ["sms", "whatsapp", "voz"].includes(c) ? c : "whatsapp";
}

function genOTP(len = OTP_LEN) { let code = ""; while (code.length < len) code += Math.floor(Math.random()*10); return code.slice(0,len); }
function getUserId(req){ const u = req.usuario || req.user || {}; return u._id || u.id || u.uid || u.sub || null; }

async function enviarCodigo(req, res) {
  try {
    const userId = getUserId(req);
    const canal = pickChannel(req.body?.canal);
    const telefono = normalizePhone(req.body?.telefono, { canal });
    if (!userId) return res.status(401).json({ mensaje: "No autenticado" });
    if (!telefono) return res.status(400).json({ mensaje: "Teléfono requerido" });

    const last = await PhoneOTP.findOne({ userId, telefono }).sort({ createdAt: -1 }).lean();
    if (last && Date.now() - new Date(last.sentAt).getTime() < RESEND_COOLDOWN_MS) {
      const rest = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(last.sentAt).getTime()))/1000);
      return res.status(429).json({ mensaje: `Espera ${rest}s para reenviar` });
    }

    const code = genOTP();
    const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);

    await PhoneOTP.create({ userId, telefono, channel: canal, codeHash: hash(code), sentAt: new Date(), expiresAt });

    const body = `Tu código de AnunciaYA es: ${code}\nCaduca en 10 minutos.`;
    if (process.env.NODE_ENV !== "production") console.log("[OTP] canal:", canal, "to:", telefono);

    try {
      if (canal === "whatsapp") await sendWhatsApp({ to: telefono, body });
      else if (canal === "voz") await sendVoice({ to: telefono, body });
      else await sendSMS({ to: telefono, body });
    } catch (e) { console.error("[notify] fallo provider:", e?.message || e); }

    const payload = { ok: true, cooldown: RESEND_COOLDOWN_MS/1000, ttl: OTP_TTL_SEC };
    if (String(process.env.PHONE_ECHO_OTP || "").toLowerCase() === "true") payload.code = code;
    return res.json(payload);
  } catch (e) {
    console.error("enviarCodigo error:", e);
    return res.status(500).json({ mensaje: "No se pudo enviar el código" });
  }
}

async function verificarCodigo(req, res) {
  try {
    const userId = getUserId(req);
    const canal = pickChannel(req.body?.canal);
    const telefono = normalizePhone(req.body?.telefono, { canal });
    const codigo = String(req.body?.codigo || "");
    if (!userId) return res.status(401).json({ mensaje: "No autenticado" });
    if (!telefono || !codigo) return res.status(400).json({ mensaje: "Teléfono y código son obligatorios" });

    const rec = await PhoneOTP.findOne({ userId, telefono }).sort({ createdAt: -1 });
    if (!rec) return res.status(404).json({ mensaje: "No hay código activo" });
    if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) return res.status(410).json({ mensaje: "Código expirado" });

    rec.attempts = (rec.attempts || 0) + 1; await rec.save();
    if (hash(codigo) !== rec.codeHash) return res.status(401).json({ mensaje: "Código incorrecto" });

    const upd = await Usuario.findByIdAndUpdate(userId, { $set: { telefono, telefonoVerificado: true, telefonoVerificadoAt: new Date() } }, { new: true }).lean();
    return res.json({ ok: true, usuario: upd });
  } catch (e) {
    console.error("verificarCodigo error:", e);
    return res.status(500).json({ mensaje: "No se pudo verificar el código" });
  }
}

module.exports = { enviarCodigo, verificarCodigo };
