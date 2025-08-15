// helpers/generarJWT-1.js
const jwt = require("jsonwebtoken");

/**
 * Genera un JWT con uid respetando configuración del .env.
 * Ahora valida explícitamente que JWT_SECRET exista.
 */
const generarJWT = (uid) => {
  return new Promise((resolve, reject) => {
    if (!process.env.JWT_SECRET) {
      return reject(new Error("JWT_SECRET no está definido en el entorno"));
    }

    const payload = { uid };
    const signOptions = {
      expiresIn: process.env.JWT_EXPIRES_IN || "30d",
    };

    if (process.env.JWT_ISS) signOptions.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) signOptions.audience = process.env.JWT_AUD;

    jwt.sign(payload, process.env.JWT_SECRET, signOptions, (err, token) => {
      if (err) return reject(err);
      resolve(token);
    });
  });
};

module.exports = generarJWT;
