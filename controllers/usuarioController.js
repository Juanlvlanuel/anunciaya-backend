// controllers/usuarioController-1.js
// Barrel export compatible (sin operador spread) para evitar errores de sintaxis
// y mantener la API pública idéntica a tu usuarioController original.

const auth = require("./authController");
const google = require("./googleController");
const profile = require("./profileController");
const session = require("./sessionController");
const search = require("./searchController");
const upload = require("./uploadController");

module.exports = Object.assign(
  {},
  auth,
  google,
  profile,
  session,
  search,
  upload
);
