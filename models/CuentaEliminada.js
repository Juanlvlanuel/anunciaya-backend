// models/CuentaEliminada.js
const mongoose = require("mongoose");

const CuentaEliminadaSchema = new mongoose.Schema({
  originalId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  datos: { type: mongoose.Schema.Types.Mixed, required: true },

  // 👇 NUEVOS CAMPOS PARA RECUPERACIÓN
  recoveryCode: { type: String, default: null },
  recoveryCodeExpira: { type: Date, default: null },
  recoveryCodeTries: { type: Number, default: 0 },

  eliminadaEn: { type: Date, default: Date.now },
}, {
  collection: "cuentas_eliminadas",
  timestamps: true,
});

// Búsqueda rápida por correo dentro de "datos"
CuentaEliminadaSchema.index({ "datos.correo": 1 });

module.exports = mongoose.model("CuentaEliminada", CuentaEliminadaSchema);
