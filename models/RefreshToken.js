// models/RefreshToken.js
const { Schema, model } = require("mongoose");
const { createHash } = require("crypto");

/**
 * RefreshToken schema para rotación segura por familia.
 * Compatible con helpers/tokens.js y rutas que usan RefreshToken.hash(raw).
 * 
 * Nota: evitamos duplicar índices en `expiresAt`. El TTL se define sólo con
 * `schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })` para no chocar
 * con `index: true` al nivel de campo (que podía generar la advertencia
 * "Duplicate schema index on ('expiresAt': 1)").
 */
const RefreshTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "Usuario",
      required: true,
      index: true,
    },
    jti: { type: String, required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // IMPORTANTE: no declarar `index: true` aquí para evitar duplicado del TTL.
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    collection: "refresh_tokens",
  }
);

// TTL automático al expirar (único índice sobre expiresAt)
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// === Static util para hashear el refresh crudo (usado en /auth/refresh) ===
RefreshTokenSchema.statics.hash = function hash(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
};

module.exports = model("RefreshToken", RefreshTokenSchema);
