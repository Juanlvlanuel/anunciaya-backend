const mongoose = require("mongoose");

const ChatSchema = new mongoose.Schema(
  {
    participantes: [{ type: mongoose.Schema.Types.ObjectId, ref: "Usuario" }],
    ultimoMensaje: { type: String },
    ultimoMensajeAt: { type: Date },
    anuncioId: { type: String },
    tipo: { type: String, enum: ["privado", "grupo"], default: "privado" },
    tituloGrupo: { type: String },
    avatarGrupoUrl: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", ChatSchema);
