// models/CuponCanje.js — colección oficial: 'cupon_canjeados'
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const CuponCanjeSchema = new Schema({
  cuponId: { type: Types.ObjectId, ref: "Cupon", required: true, index: true },
  usuarioId: { type: Types.ObjectId, ref: "Usuario", required: true, index: true },
  estado: { type: String, enum: ["asignado", "usado", "expirado"], default: "asignado" },
  codigo: { type: String, unique: true, sparse: true, index: true },
  canjeadoAt: { type: Date },
  usadoAt: { type: Date },
}, { timestamps: true });

CuponCanjeSchema.index({ usuarioId: 1, estado: 1, createdAt: -1 });

// Colección se llamará "cupon_canjeados"
module.exports = mongoose.models.CuponCanje || mongoose.model("CuponCanje", CuponCanjeSchema, "cupon_canjeados");
