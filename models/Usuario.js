// models/Usuario-1.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BLOQUEO_MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 3;

const UsuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, trim: true, maxlength: 120, default: "" },
    correo: {
      type: String,
      required: [true, "El correo es obligatorio"],
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Correo inválido"],
    },
    contraseña: {
      type: String,
      select: false,
      default: null,
      required: function () {
        return !this.autenticadoPorGoogle && !this.autenticadoPorFacebook;
      },
      validate: {
        validator: function (v) {
          if (!v) return true;
          return typeof v === "string" && v.length >= 6;
        },
        message: "La contraseña debe tener al menos 6 caracteres",
      },
    },
    telefono: { type: String, trim: true, maxlength: 30, default: "" },
    direccion: { type: String, trim: true, maxlength: 240, default: "" },
    telefonoVerificado: { type: Boolean, default: false },
    telefonoVerificadoAt: { type: Date, default: null },
    tipo: { type: String, enum: ["usuario", "comerciante"], required: true },
    perfil: { type: String, required: true, default: "1" },
    nickname: { type: String, trim: true, unique: true, index: true },
    fotoPerfil: { type: String, default: "" },
    autenticadoPorGoogle: { type: Boolean, default: false },
    autenticadoPorFacebook: { type: Boolean, default: false },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    role: { type: String, default: undefined },
    isAdmin: { type: Boolean, default: undefined },
    scope: { type: [String], default: undefined },
    creado: { type: Date, default: undefined },

    // ===== Verificación de correo =====
    emailVerificado: { type: Boolean, default: false },
    emailVerificadoAt: { type: Date, default: null },
    emailVerificationToken: { type: String, select: false, default: null }, // sha256
    emailVerificationExpires: { type: Date, default: null, select: false },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.contraseña;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        return ret;
      },
    },
  }
);

UsuarioSchema.pre("save", async function (next) {
  if (!this.isModified("contraseña") || !this.contraseña) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.contraseña = await bcrypt.hash(this.contraseña, salt);
    next();
  } catch (e) {
    next(e);
  }
});

UsuarioSchema.methods.comprobarPassword = async function (passwordIngresado) {
  if (!this.contraseña) return false;
  try {
    return await bcrypt.compare(passwordIngresado, this.contraseña);
  } catch {
    return false;
  }
};

UsuarioSchema.statics.BLOQUEO_MAX_INTENTOS = BLOQUEO_MAX_INTENTOS;
UsuarioSchema.statics.BLOQUEO_MINUTOS = BLOQUEO_MINUTOS;

module.exports = mongoose.model("Usuario", UsuarioSchema);
