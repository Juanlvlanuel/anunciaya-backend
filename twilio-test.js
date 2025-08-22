// twilio-test.js
require("dotenv").config();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsApp() {
  try {
    const msg = await client.messages.create({
      from: process.env.TWILIO_FROM_WHATSAPP, // sandbox: whatsapp:+14155238886
      to: "whatsapp:+5216381128286",          // tu número personal
      body: "Prueba desde AnunciaYA 🚀",
    });
    console.log("Mensaje enviado, SID:", msg.sid);
  } catch (err) {
    console.error("Error enviando:", err);
  }
}

sendWhatsApp();
