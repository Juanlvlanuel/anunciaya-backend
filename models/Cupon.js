// models/Cupon.js — colección oficial: 'cupones'
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const CuponSchema = new Schema({
  negocioId: { type: Types.ObjectId, ref: "Negocio", required: true, index: true },
  titulo: { type: String, required: true, trim: true },
  etiqueta: { type: String, trim: true },
  tipo: { type: String, enum: ["percent", "fixed"], default: "percent" },
  valor: { type: Number, required: true },
  colorHex: { type: String, default: "#2563eb" },
  venceAt: { type: Date, required: true, index: true },
  activa: { type: Boolean, default: true },

  stockTotal: { type: Number, default: 0 },
  stockUsado: { type: Number, default: 0 },
  limitPorUsuario: { type: Number, default: 1 },

  creadoPor: { type: Types.ObjectId, ref: "Usuario", index: true },
}, { timestamps: true });

CuponSchema.virtual("stockDisponible").get(function () {
  return Math.max(0, (this.stockTotal || 0) - (this.stockUsado || 0));
});

CuponSchema.index({ activa: 1, venceAt: 1 });

module.exports = mongoose.models.Cupon || mongoose.model("Cupon", CuponSchema, "cupones");
