// models/Usuario-1.js
// Esquema robusto con bloqueo temporal tras múltiples fallos de login (5 intentos -> 3 minutos)
// Ajuste: contraseña no requerida para Google/Facebook; validación condicional de longitud.

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BLOQUEO_MAX_INTENTOS = 5;      // después de 5 fallos consecutivos
const BLOQUEO_MINUTOS = 3;           // bloqueo por 3 minutos

const UsuarioSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      trim: true,
      maxlength: [120, "El nombre es demasiado largo"],
      default: "",
    },
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
        // Solo exigir contraseña cuando NO sea autenticación social
        return !this.autenticadoPorGoogle && !this.autenticadoPorFacebook;
      },
      validate: {
        // Permitir null/"" para cuentas sociales; si existe, mínimo 6
        validator: function (v) {
          if (!v) return true;
          return typeof v === "string" && v.length >= 6;
        },
        message: "La contraseña debe tener al menos 6 caracteres",
      },
    },
    tipo: {
      type: String,
      enum: ["usuario", "comerciante"],
      required: [true, "El tipo de cuenta es obligatorio"],
    },
    perfil: {
      type: String,
      required: [true, "El perfil es obligatorio"],
      default: "1",
    },
    nickname: {
      type: String,
      trim: true,
      unique: true,
      index: true,
    },
    fotoPerfil: {
      type: String,
      default: "",
    },
    autenticadoPorGoogle: {
      type: Boolean,
      default: false,
    },
    autenticadoPorFacebook: {
      type: Boolean,
      default: false,
    },

    // ==== Seguridad de login ====
    failedLoginCount: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.contraseña;
        return ret;
      },
    },
  }
);

// Hash de contraseña si es nueva o fue modificada
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

// Compara contraseña ingresada contra el hash guardado
UsuarioSchema.methods.comprobarPassword = async function (passwordIngresado) {
  if (!this.contraseña) return false;
  try {
    return await bcrypt.compare(passwordIngresado, this.contraseña);
  } catch {
    return false;
  }
};

// Exponer constantes para uso en controlador
UsuarioSchema.statics.BLOQUEO_MAX_INTENTOS = BLOQUEO_MAX_INTENTOS;
UsuarioSchema.statics.BLOQUEO_MINUTOS = BLOQUEO_MINUTOS;

module.exports = mongoose.model("Usuario", UsuarioSchema);
