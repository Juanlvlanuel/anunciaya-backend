const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, trim: true },
  correo: { type: String, required: true, unique: true, lowercase: true, trim: true },
  contraseña: { type: String, required: false }, // ✅ Ya NO es requerida
  tipo: { type: String, enum: ["usuario", "comerciante"], required: true },
  perfil: { type: Number, default: null },
  nickname: { type: String, unique: true, sparse: true, trim: true },
  fotoPerfil: { type: String, default: "" },
  autenticadoPorGoogle: { type: Boolean, default: false },
  autenticadoPorFacebook: { type: Boolean, default: false },
  creado: { type: Date, default: Date.now }
});

usuarioSchema.pre("save", async function (next) {
  if (!this.isModified("contraseña")) return next();
  // Solo hashea si hay contraseña y tiene al menos 4 caracteres
  if (!this.contraseña || this.contraseña.length < 4) return next();
  const salt = await bcrypt.genSalt(10);
  this.contraseña = await bcrypt.hash(this.contraseña, salt);
  next();
});

usuarioSchema.methods.comprobarPassword = async function (passwordIngresado) {
  if (!this.contraseña) return false;
  return await bcrypt.compare(passwordIngresado, this.contraseña);
};

const Usuario = mongoose.model("Usuario", usuarioSchema);
module.exports = Usuario;
