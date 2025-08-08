const mongoose = require("mongoose");

const ArchivoSchema = new mongoose.Schema(
  {
    filename: String,
    url: String,
    mimeType: String,
    size: Number,
    isImage: Boolean,
    width: Number,
    height: Number,
  },
  { _id: false }
);

const MensajeSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", index: true },
    emisor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", index: true },
    texto: { type: String },
    archivos: [ArchivoSchema],
    leidoPor: [{ type: mongoose.Schema.Types.ObjectId, ref: "Usuario" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Mensaje", MensajeSchema);
