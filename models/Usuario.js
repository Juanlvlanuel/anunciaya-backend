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
    emailVerificado: { type: Boolean, default: false, select: true },
    logoutAt: { type: Date, default: null, index: true },
    emailVerificadoAt: { type: Date, default: null },
    codigoVerificacionEmail: {type: String,select: false,default: null},
    codigoVerificacionExpira: {type: Date,default: null,select: false},

    emailVerificationToken: { type: String, select: false, default: null },
    emailVerificationExpires: { type: Date, default: null, select: false },

    // ===== Campos 2FA =====
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false, default: null },
    twoFactorConfirmed: { type: Boolean, default: false },
    // ===== Códigos de respaldo (se devuelven solo al generarlos) =====
    backupCodes: {
      type: [
        {
          hash: { type: String, required: true }, // bcrypt del código
          usedAt: { type: Date, default: null },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.contraseña;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.twoFactorSecret;
        delete ret.backupCodes;
        return ret;
      },
    },
  }
);

/**
 * Normaliza el estado de 2FA para evitar estados rotos.
 * Reglas:
 *  - No se permite enabled=true si no hay secret o si no está confirmed.
 *  - Si secret es null se fuerzan confirmed=false y enabled=false.
 *  - Si no está enabled y no hay secret, confirmed debe ser false.
 */
function normalize2FA(docLike) {
  if (!docLike) return;
  const hasSecret = !!docLike.twoFactorSecret;
  const confirmed = !!docLike.twoFactorConfirmed;
  if (!hasSecret) {
    docLike.twoFactorConfirmed = false;
    docLike.twoFactorEnabled = false;
  } else if (!confirmed) {
    docLike.twoFactorEnabled = false;
  } else if (docLike.twoFactorEnabled && (!hasSecret || !confirmed)) {
    docLike.twoFactorEnabled = false;
  }
}

// save (create/update modelo)
UsuarioSchema.pre("save", function (next) {
  try {
    normalize2FA(this);
    // Hash password si cambió
    if (!this.isModified("contraseña") || !this.contraseña) return next();
  } catch (_) { }
  next();
});

// Hash password en save (mantenemos el bloque original)
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

// findOneAndUpdate / updateOne / updateMany: forzar consistencia de 2FA en updates
function normalizeUpdate(update) {
  if (!update) return update;
  // Unificar en $set
  if (update.$set == null) update.$set = {};
  const u = update.$set;

  // Si están mandando campos directos (sin $set), muévelos a $set
  for (const k of ["twoFactorEnabled", "twoFactorSecret", "twoFactorConfirmed"]) {
    if (Object.prototype.hasOwnProperty.call(update, k)) {
      u[k] = update[k];
      delete update[k];
    }
  }

  // Reglas de consistencia
  const hasSecret = u.twoFactorSecret !== undefined ? !!u.twoFactorSecret : undefined;
  const willNullSecret = u.twoFactorSecret === null;

  if (willNullSecret) {
    u.twoFactorConfirmed = false;
    u.twoFactorEnabled = false;
  }

  if (u.twoFactorEnabled === true) {
    // Solo permitir enabled=true si hay secret (actual o venidero) y confirmed=true
    const confirmed = u.twoFactorConfirmed === true;
    if (!confirmed) u.twoFactorEnabled = false;
  }

  return update;
}

UsuarioSchema.pre("findOneAndUpdate", function (next) {
  try { this.setUpdate(normalizeUpdate(this.getUpdate())); } catch (_) { }
  next();
});

UsuarioSchema.pre("updateOne", function (next) {
  try { this.setUpdate(normalizeUpdate(this.getUpdate())); } catch (_) { }
  next();
});

UsuarioSchema.pre("updateMany", function (next) {
  try { this.setUpdate(normalizeUpdate(this.getUpdate())); } catch (_) { }
  next();
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
