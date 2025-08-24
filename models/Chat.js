// models/Chat.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Modelo de chat 1:1 o grupal.
 * Incluye favoritos por usuario (favoritesBy),
 * eliminación “para mí” (deletedFor),
 * mensajes fijados por usuario (pinsByUser),
 * y bloqueo por usuario (blockedBy).
 */
const ChatSchema = new Schema(
  {
    tipo: { type: String, enum: ["privado", "grupo"], default: "privado" },

    // Participantes (siempre usar este arreglo)
    participantes: [{ type: Schema.Types.ObjectId, ref: "Usuario", index: true }],

    // Legacy opcional
    usuarioA: { type: Schema.Types.ObjectId, ref: "Usuario" },
    usuarioB: { type: Schema.Types.ObjectId, ref: "Usuario" },

    // Relación opcional a un anuncio/oferta
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

    // === BLOQUEO por usuario (clave que faltaba) ===
    blockedBy: [{ type: Schema.Types.ObjectId, ref: "Usuario", default: [] }],

        // === Fondo por chat (persistente) ===
    backgroundUrl: { type: String, default: "" },

    // === Meta para ordenar y mostrar previas ===
    ultimoMensaje: { type: String, default: "" },
    ultimoMensajeAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Índices útiles
ChatSchema.index({ participantes: 1, updatedAt: -1 });
ChatSchema.index({ tipo: 1, participantes: 1 });
// Opcional
ChatSchema.index({ blockedBy: 1 });

module.exports = mongoose.model("Chat", ChatSchema);
