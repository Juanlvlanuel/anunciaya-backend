// ✅ helpers/generarJWT.js
const jwt = require("jsonwebtoken");

const generarJWT = (uid) => {
  return new Promise((resolve, reject) => {
    jwt.sign(
      { uid },
      process.env.JWT_SECRET, // asegúrate de tener esta variable en tu archivo .env
      {
        expiresIn: "30d",
      },
      (err, token) => {
        if (err) {
          reject("No se pudo generar el token");
        } else {
          resolve(token);
        }
      }
    );
  });
};

module.exports = generarJWT;

