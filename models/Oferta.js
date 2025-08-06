// ✅ models/Oferta.js (versión avanzada con interacción social y métricas)

const mongoose = require("mongoose");

const ComentarioSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true
  },
  mensaje: {
    type: String,
    required: true
  },
  fecha: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const ReaccionSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true
  },
  tipo: {
    type: String,
    enum: ["like", "love"],
    default: "like"
  }
}, { _id: false });

const OfertaSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  descripcion: { type: String, required: true },
  imagen: { type: String },
  precio: { type: Number, required: true },
  categoria: { type: String },
  estadoOferta: {
    type: String,
    enum: ["activa", "expirada", "oculta"],
    default: "activa"
  },
  fechaPublicacion: { type: Date, default: Date.now },
  fechaExpiracion: { type: Date },

  // Ubicación geoespacial
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

  creador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true
  },

  // Interacción social
  comentarios: [ComentarioSchema],
  likes: [ReaccionSchema],
  guardados: [{ type: mongoose.Schema.Types.ObjectId, ref: "Usuario" }],

  // Métricas
  visualizaciones: { type: Number, default: 0 }

}, { timestamps: true });

// Índice geoespacial
OfertaSchema.index({ ubicacion: "2dsphere" });

module.exports = mongoose.model("Oferta", OfertaSchema);
