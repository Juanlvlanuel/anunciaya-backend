// models/Mensaje.js
const mongoose = require("mongoose");

const ArchivoSchema = new mongoose.Schema(
  {
    name: String,       // opcional (frontend)
    filename: String,
    url: String,
    thumbUrl: String,   // miniatura para previews rápidos
    mimeType: String,
    size: Number,
    isImage: Boolean,
    width: Number,
    height: Number,
  },
  { _id: false }
);

// ===== Subdocumentos para reply / forward =====
const ReplyAutorSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    nickname: String,
    nombre: String,
  },
  { _id: false }
);

const ReplySchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Mensaje" }, // id del mensaje respondido (opcional)
    texto: String,        // texto del mensaje original
    preview: String,      // respaldo/alias del texto
    autor: ReplyAutorSchema,
  },
  { _id: false }
);

const ForwardSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Mensaje" }, // id del mensaje reenviado
  },
  { _id: false }
);

const MensajeSchema = new mongoose.Schema(
  {
    chat:   { type: mongoose.Schema.Types.ObjectId, ref: "Chat", index: true },
    emisor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", index: true },
    texto:  { type: String },
    archivos: [ArchivoSchema],

    // NUEVO: respuesta y reenviado
    replyTo: ReplySchema,
    forwardOf: ForwardSchema,

    leidoPor: [{ type: mongoose.Schema.Types.ObjectId, ref: "Usuario" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Mensaje", MensajeSchema);
