
// models/PhoneOTP.js
const mongoose = require("mongoose");

const PhoneOTPSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", required: true, index: true },
    telefono: { type: String, required: true, trim: true, index: true },
    channel: { type: String, enum: ["sms", "whatsapp", "voz"], required: true },
    codeHash: { type: String, required: true }, // sha256(OTP)
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true }, // TTL index
  },
  { timestamps: true, versionKey: false }
);

// TTL for expiresAt (Mongo creates in background)
PhoneOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PhoneOTP", PhoneOTPSchema);
