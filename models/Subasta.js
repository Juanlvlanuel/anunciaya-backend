const mongoose = require("mongoose");

const subastaSchema = new mongoose.Schema({
  titulo: String,
  descripcion: String,
  precioInicial: Number,
  fechaLimite: Date,
  ciudad: String,
  estado: String,
  coordenadas: {
    lat: Number,
    lng: Number,
  },
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario"
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model("Subasta", subastaSchema);
