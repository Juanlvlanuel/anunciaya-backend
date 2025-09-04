
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
    // --- CardV1 (opcionales) ---
    logoUrl: { type: String, trim: true, default: "" },
    badges: { type: [String], default: [] },          // ej: ["Envío gratis", "VIP"]

    // Métricas básicas para listado
    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviews: { type: Number, min: 0, default: 0 },

    // Precio y horario
    priceLevel: { type: Number, min: 1, max: 4, default: 1 }, // 1–4
    closingTime: { type: String, trim: true, default: "" },    // ej: "21:00"

    // Promoción vigente
    promoText: { type: String, trim: true, default: "" },
    promoExpiresAt: { type: Date, default: null },

    // Ubicación simple (para calcular distanceKm)
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    fotos: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Único por usuario + nombre (opcional, suave)
NegocioSchema.index({ usuarioId: 1, nombre: 1 }, { unique: false });

module.exports = mongoose.model("Negocio", NegocioSchema);
