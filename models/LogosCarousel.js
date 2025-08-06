const mongoose = require("mongoose");

const LogosCarouselSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
  },
  archivo: {
    type: String, // nombre del archivo de imagen
    required: true,
  },
  orden: {
    type: Number,
    default: 0,
  },
  activo: {
    type: Boolean,
    default: true,
  },
  fechaRegistro: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model("LogosCarousel", LogosCarouselSchema);

