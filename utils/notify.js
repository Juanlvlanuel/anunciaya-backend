// utils/notify-1.js (con logs de depuración)
let twilioClient = null;
const hasTwilio =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  (!!process.env.TWILIO_FROM_SMS || !!process.env.TWILIO_FROM_WHATSAPP);

if (hasTwilio) {
  try {
    const twilio = require("twilio");
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (e) {
    console.warn("[notify] Twilio no disponible, usando stub. Motivo:", e?.message);
  }
}

async function sendSMS({ to, body }) {
  if (twilioClient && process.env.TWILIO_FROM_SMS) {
    const from = process.env.TWILIO_FROM_SMS;
    console.log("[notify][SMS] from:", from, "to:", to, "body:", body);
    const msg = await twilioClient.messages.create({ from, to, body });
    console.log("[notify][SMS] SID:", msg.sid);
    return { ok: true, sid: msg.sid };
  }
  console.log("[notify][SMS][stub] =>", to, body);
  return { ok: true, sid: "stub-sms" };
}

async function sendWhatsApp({ to, body }) {
  const from = process.env.TWILIO_FROM_WHATSAPP;
  const toWa = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  if (twilioClient && from) {
    console.log("[notify][WA] from:", from, "to:", toWa, "body:", body);
    try {
      const msg = await twilioClient.messages.create({ from, to: toWa, body });
      console.log("[notify][WA] SID:", msg.sid);
      return { ok: true, sid: msg.sid };
    } catch (err) {
      console.error("[notify][WA] ERROR:", err?.message || err);
      throw err;
    }
  }
  console.log("[notify][WA][stub] =>", toWa, body);
  return { ok: true, sid: "stub-wa" };
}

async function sendVoice({ to, body }) {
  if (twilioClient && (process.env.TWILIO_FROM_VOICE || process.env.TWILIO_FROM_SMS)) {
    const from = process.env.TWILIO_FROM_VOICE || process.env.TWILIO_FROM_SMS;
    const twiml = `<Response><Say> ${body} </Say></Response>`;
    console.log("[notify][VOICE] from:", from, "to:", to);
    const call = await twilioClient.calls.create({ to, from, twiml });
    console.log("[notify][VOICE] SID:", call.sid);
    return { ok: true, sid: call.sid };
  }
  console.log("[notify][VOICE][stub] =>", to, body);
  return { ok: true, sid: "stub-voice" };
}

module.exports = { sendSMS, sendWhatsApp, sendVoice };
