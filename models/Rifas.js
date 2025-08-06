// ✅ models/Rifa.js

const mongoose = require("mongoose");

const ParticipanteSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true,
  },
  numerosComprados: [Number],
  comprobantePago: {
    url: String,
    nombreArchivo: String,
  },
  estadoPago: {
    type: String,
    enum: ["pendiente", "validado", "rechazado"],
    default: "pendiente",
  }
}, { _id: false });

const RifaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  descripcion: { type: String, required: true },
  imagen: { type: String }, // URL a Cloudinary u otro
  precioBoleto: { type: Number, required: true },
  cantidadBoletos: { type: Number, required: true },
  boletosDisponibles: [Number],
  boletosVendidos: [Number],
  tipoRifa: {
    type: String,
    enum: ["aleatoria", "loteria", "expres", "flash", "ranking", "dinero"],
    default: "aleatoria"
  },
  fechaSorteo: { type: Date, required: true },
  reglas: { type: String },
  estado: {
    type: String,
    enum: ["activa", "finalizada", "cancelada", "pospuesta"],
    default: "activa"
  },
  ganador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    default: null
  },
  ubicacion: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitud, latitud]
      required: true
    },
    ciudad: String,
    estado: String
  },
  organizador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true
  },
  participantes: [ParticipanteSchema]
}, { timestamps: true });

// Índice geoespacial
RifaSchema.index({ ubicacion: "2dsphere" });

module.exports = mongoose.model("Rifas", RifaSchema);
