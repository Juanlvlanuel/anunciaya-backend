// models/Chat.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Modelo de chat 1:1 o grupal.
 * Incluye favoritos por usuario (favoritesBy),
 * eliminación “para mí” (deletedFor),
 * y mensajes fijados por usuario (pinsByUser).
 */
const ChatSchema = new Schema(
  {
    tipo: { type: String, enum: ["privado", "grupo"], default: "privado" },

    // Participantes: usamos siempre este arreglo (el legacy usuarioA/usuarioB es opcional)
    participantes: [{ type: Schema.Types.ObjectId, ref: "Usuario", index: true }],

    // Legacy opcional (si todavía lo usas en algún sitio)
    usuarioA: { type: Schema.Types.ObjectId, ref: "Usuario" },
    usuarioB: { type: Schema.Types.ObjectId, ref: "Usuario" },

    // Relación opcional a un anuncio/oferta si aplicara
    anuncioId: { type: Schema.Types.ObjectId, ref: "Oferta", default: null },

    // === Favoritos por usuario ===
    favoritesBy: [{ type: Schema.Types.ObjectId, ref: "Usuario", default: [] }],

    // === Soft delete “para mí” ===
    deletedFor: [{ type: Schema.Types.ObjectId, ref: "Usuario", default: [] }],

    // === Mensajes fijados por usuario ===
    // Mapa: userId -> [messageId, ...] (máx 5)
    pinsByUser: {
      type: Map,
      of: [{ type: Schema.Types.ObjectId, ref: "Mensaje" }],
      default: () => new Map(),
    },

    // === Meta para ordenar y mostrar previas ===
    ultimoMensaje: { type: String, default: "" },
    ultimoMensajeAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Índices útiles
ChatSchema.index({ participantes: 1, updatedAt: -1 });
ChatSchema.index({ tipo: 1, participantes: 1 });

module.exports = mongoose.model("Chat", ChatSchema);
