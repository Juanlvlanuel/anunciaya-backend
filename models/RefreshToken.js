// models/RefreshToken-1.js
const { Schema, model } = require("mongoose");
const { createHash } = require("crypto");

/**
 * RefreshToken schema con TTL + metadata opcional (ip/ua/lastUsedAt).
 * Es retrocompatible: documentos viejos siguen siendo válidos.
 */
const RefreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "Usuario", required: true, index: true },
    jti: { type: String, required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true }, // TTL por índice
    revokedAt: { type: Date, default: null, index: true },

    // Metadata opcional para "Sesiones y dispositivos"
    ip: { type: String, default: null },
    ua: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "refresh_tokens",
  }
);

// TTL automático
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

RefreshTokenSchema.statics.hash = function hash(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
};

module.exports = model("RefreshToken", RefreshTokenSchema);
