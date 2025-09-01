
// models/Negocio-1.js
const mongoose = require("mongoose");

const NegocioSchema = new mongoose.Schema(
  {
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, index: true },
    nombre: { type: String, required: true, trim: true, maxlength: 120 },

    // Etiquetas "humanas" (opcional, para mostrar)
    categoria: { type: String, trim: true, maxlength: 120, default: "" },
    subcategoria: { type: String, trim: true, maxlength: 120, default: "" },

    // Slugs normalizados para filtros/búsquedas
    categoriaSlug: { type: String, required: true, trim: true, lowercase: true, index: true },
    subcategoriaSlug: { type: String, trim: true, lowercase: true, index: true, default: "" },

    ciudad: { type: String, required: true, trim: true, maxlength: 120 },
    whatsapp: { type: String, trim: true, maxlength: 20, default: "" },
    telefono: { type: String, trim: true, maxlength: 20, default: "" },
    direccion: { type: String, trim: true, maxlength: 200, default: "" },

    activo: { type: Boolean, default: true },
    descripcion: { type: String, trim: true, maxlength: 1000, default: "" },
    fotos: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Único por usuario + nombre (opcional, suave)
NegocioSchema.index({ usuarioId: 1, nombre: 1 }, { unique: false });

module.exports = mongoose.model("Negocio", NegocioSchema);
