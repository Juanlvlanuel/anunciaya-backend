// models/Admin.js - Actualizado con niveles
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema({
  usuario: {
    type: String,
    required: true,
    unique: true,
  },
  contraseña: {
    type: String,
    required: true,
  },
  nivel: {
    type: String,
    enum: ["super", "general", "moderador"],
    default: "moderador",
    required: true
  },
  permisos: [{
    type: String,
    enum: [
      // Gestión de usuarios
      "users:read", "users:create", "users:update", "users:delete",
      // Configuración de acciones
      "actions:read", "actions:create", "actions:update", "actions:delete",
      // Gestión de perfiles
      "profiles:read", "profiles:update",
      // Configuración del sistema
      "system:read", "system:update",
      // Gestión de otros admins
      "admins:read", "admins:create", "admins:update", "admins:delete"
    ]
  }],
  activo: {
    type: Boolean,
    default: true
  },
  creadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    default: null
  },
  ultimoAcceso: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Hash password antes de guardar
adminSchema.pre("save", async function (next) {
  if (!this.isModified("contraseña")) return next();
  const salt = await bcrypt.genSalt(10);
  this.contraseña = await bcrypt.hash(this.contraseña, salt);
  next();
});

// CORREGIDO: Asignar permisos por defecto según nivel (JERARQUÍA ESTRICTA)
adminSchema.pre("save", function (next) {
  // CORREGIDO: También ejecutar para documentos nuevos
  if (!this.isModified("nivel") && !this.isNew) return next();
  
  // Limpiar permisos existentes si cambió el nivel
  this.permisos = [];
  
  // Permisos base para MODERADOR
  const permisosModerador = [
    "users:read",
    "actions:read", 
    "profiles:read"
  ];
  
  // Permisos adicionales para ADMIN GENERAL (hereda moderador + nuevos)
  const permisosGeneral = [
    ...permisosModerador,
    "users:update",
    "actions:create", "actions:update", "actions:delete",
    "profiles:update"
  ];
  
  // Permisos adicionales para SUPER ADMIN (hereda general + nuevos)
  const permisosSuper = [
    ...permisosGeneral,
    "users:create", "users:delete",
    "system:read", "system:update", 
    "admins:read", "admins:create", "admins:update", "admins:delete"
  ];
  
  switch(this.nivel) {
    case "super":
      this.permisos = permisosSuper;
      break;
    case "general": 
      this.permisos = permisosGeneral;
      break;
    case "moderador":
    default: // CORREGIDO: Agregar default
      this.permisos = permisosModerador;
      break;
  }
  next();
});

adminSchema.methods.compararPassword = async function (passwordFormulario) {
  return await bcrypt.compare(passwordFormulario, this.contraseña);
};

adminSchema.methods.tienePermiso = function (permiso) {
  return this.activo && this.permisos.includes(permiso);
};

adminSchema.methods.puedeGestionar = function (recurso) {
  const acciones = ["read", "create", "update", "delete"];
  return acciones.some(accion => this.tienePermiso(`${recurso}:${accion}`));
};

const Admin = mongoose.model("Admin", adminSchema);
module.exports = Admin;