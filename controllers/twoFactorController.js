
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const Usuario = require("../models/Usuario");

exports.generarSetup = async (req, res) => {
  try {
    const uid = req.usuario?._id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const secret = speakeasy.generateSecret({ length: 20 });
    const otpauth = secret.otpauth_url.replace("SecretKey", "AnunciaYA");

    await Usuario.findByIdAndUpdate(uid, {
      twoFactorSecret: secret.base32,
      twoFactorConfirmed: false,
    });

    const qr = await qrcode.toDataURL(otpauth);
    res.json({ otpauth, qr });
  } catch (err) {
    res.status(500).json({ mensaje: "Error generando QR" });
  }
};

exports.verificarCodigo = async (req, res) => {
  try {
    const uid = req.usuario?._id;
    const { codigo } = req.body;
    if (!uid || !codigo) return res.status(400).json({ mensaje: "Código requerido" });

    const usuario = await Usuario.findById(uid).select("+twoFactorSecret");
    if (!usuario?.twoFactorSecret) return res.status(400).json({ mensaje: "2FA no configurado" });

    const verified = speakeasy.totp.verify({
      secret: usuario.twoFactorSecret,
      encoding: "base32",
      token: codigo,
      window: 1,
    });

    if (!verified) return res.status(401).json({ mensaje: "Código inválido" });

    usuario.twoFactorEnabled = true;
    usuario.twoFactorConfirmed = true;
    await usuario.save();

    res.json({ mensaje: "2FA activado con éxito" });
  } catch (err) {
    res.status(500).json({ mensaje: "Error verificando código" });
  }
};

exports.desactivar2FA = async (req, res) => {
  try {
    const uid = req.usuario?._id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    await Usuario.findByIdAndUpdate(uid, {
      $set: {
        twoFactorEnabled: false,
        twoFactorConfirmed: false,
        twoFactorSecret: null,
      },
    });

    res.json({ mensaje: "2FA desactivado" });
  } catch (err) {
    res.status(500).json({ mensaje: "Error desactivando 2FA" });
  }
};
