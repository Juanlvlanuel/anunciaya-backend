// utils/mailer-1.js
const nodemailer = require("nodemailer");

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const sgKey = process.env.SENDGRID_API_KEY;

  // Prioriza SMTP tradicional; si no hay, intenta SendGrid SMTP
  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        // 👇 Esto evita el error "self-signed certificate in certificate chain"
        rejectUnauthorized: false
      }
    });
  }

  // SendGrid vía SMTP
  if (sgKey) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      auth: { user: "apikey", pass: sgKey },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  return null;
}

/**
 * Envía un correo usando SMTP/SendGrid configurado por env.
 * @param {object} param0 {to, subject, text?, html?, from?}
 */
async function sendMail({ to, subject, text, html, from }) {
  const transporter = getTransport();
  if (!transporter) {
    throw new Error("SMTP/SendGrid no configurado (faltan variables de entorno)");
  }
  const opts = {
    from: from || process.env.EMAIL_FROM || "no-reply@anunciaya.com",
    to,
    subject,
    text: text || "",
    html: html || (text ? `<pre>${String(text)}</pre>` : undefined),
  };
  return transporter.sendMail(opts);
}

module.exports = { sendMail };
