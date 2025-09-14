// ===== adminAuthController.js - ARCHIVO COMPLETO CORREGIDO =====
// controllers/adminAuthController.js - Sistema Admin Unificado
const Admin = require("../models/Admin");
const jwt = require("jsonwebtoken");

/**
 * Genera JWT para administradores con role: "admin"
 */
function signAdminJWT(adminId) {
  const payload = { 
    uid: adminId,
    role: "admin",
    isAdmin: true
  };
  
  const signOptions = {
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  };

  if (process.env.JWT_ISS) signOptions.issuer = process.env.JWT_ISS;
  if (process.env.JWT_AUD) signOptions.audience = process.env.JWT_AUD;

  return jwt.sign(payload, process.env.JWT_SECRET, signOptions);
}

/**
 * Login de administrador unificado con validación, sanitización y manejo de errores.
 * Combina lo mejor de ambos controladores anteriores.
 */
const loginAdmin = async (req, res) => {
  try {
    // Sanitización y validación de entrada
    const rawUsuario = (req.body?.usuario ?? "").toString().trim();
    const rawPassword = (req.body?.contraseña ?? req.body?.password ?? "").toString();

    if (!rawUsuario || !rawPassword) {
      return res.status(400).json({ 
        msg: "Faltan credenciales: usuario y contraseña son obligatorios",
        error: { code: "MISSING_CREDENTIALS" }
      });
    }

    // Validaciones de formato
    if (rawUsuario.length < 3 || rawUsuario.length > 64) {
      return res.status(400).json({ 
        msg: "Usuario inválido",
        error: { code: "INVALID_USER_FORMAT" }
      });
    }
    
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      return res.status(400).json({ 
        msg: "Contraseña inválida",
        error: { code: "INVALID_PASSWORD_FORMAT" }
      });
    }

    // Búsqueda de admin
    const admin = await Admin.findOne({ usuario: rawUsuario });
    if (!admin) {
      return res.status(401).json({ 
        msg: "Usuario o contraseña incorrectos",
        error: { code: "INVALID_CREDENTIALS" }
      });
    }

    // Comparación de contraseña
    const esCorrecto = await admin.compararPassword(rawPassword);
    if (!esCorrecto) {
      return res.status(401).json({ 
        msg: "Usuario o contraseña incorrectos",
        error: { code: "INVALID_CREDENTIALS" }
      });
    }

    // Respuesta exitosa con JWT real
    return res.status(200).json({
      msg: "Login exitoso",
      _id: admin._id,
      usuario: admin.usuario,
      nivel: admin.nivel,
      token: signAdminJWT(admin._id),
      issuedAt: Date.now()
    });

  } catch (error) {
    // Log interno para desarrollo
    if (process.env.NODE_ENV !== "production") {
      console.error("Error en loginAdmin:", error?.message || error);
    }
    
    // Respuesta genérica para no exponer detalles internos
    return res.status(500).json({ 
      msg: "Error del servidor",
      error: { code: "INTERNAL_SERVER_ERROR" }
    });
  }
};

/**
 * Registro de administrador con validación robusta.
 * CORREGIDO: Incluye nivel y validaciones
 */
const registrarAdmin = async (req, res) => {
  try {
    // CORREGIDO: Extraer nivel del body
    const { usuario, contraseña, nivel = "moderador" } = req.body || {};
    
    if (!usuario || !contraseña) {
      return res.status(400).json({ 
        msg: "Faltan campos obligatorios (usuario, contraseña)",
        error: { code: "MISSING_FIELDS" }
      });
    }

    // Validar nivel si se proporciona
    const nivelesValidos = ["super", "general", "moderador"];
    if (nivel && !nivelesValidos.includes(nivel)) {
      return res.status(400).json({ 
        msg: "Nivel inválido. Debe ser: super, general o moderador",
        error: { code: "INVALID_LEVEL" }
      });
    }

    // Validaciones de formato
    if (usuario.length < 3 || usuario.length > 64) {
      return res.status(400).json({ 
        msg: "Usuario debe tener entre 3 y 64 caracteres",
        error: { code: "INVALID_USER_LENGTH" }
      });
    }
    
    if (contraseña.length < 6 || contraseña.length > 128) {
      return res.status(400).json({ 
        msg: "Contraseña debe tener entre 6 y 128 caracteres",
        error: { code: "INVALID_PASSWORD_LENGTH" }
      });
    }

    // Verificar si ya existe
    const existeAdmin = await Admin.findOne({ usuario });
    if (existeAdmin) {
      return res.status(409).json({ 
        msg: "El usuario ya existe",
        error: { code: "USER_EXISTS" }
      });
    }

    // CORREGIDO: Crear nuevo admin con nivel
    const nuevoAdmin = new Admin({ 
      usuario, 
      contraseña, 
      nivel,
      creadoPor: req.admin?.id || null // Rastrear quién lo creó
    });
    await nuevoAdmin.save();

    return res.status(201).json({ 
      msg: "Administrador creado exitosamente",
      admin: {
        _id: nuevoAdmin._id,
        usuario: nuevoAdmin.usuario,
        nivel: nuevoAdmin.nivel,
        permisos: nuevoAdmin.permisos
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Error en registrarAdmin:", error?.message || error);
    }

    // Manejo específico de errores de duplicado
    if (error?.code === 11000) {
      return res.status(409).json({ 
        msg: "El usuario ya está registrado",
        error: { code: "DUPLICATE_USER" }
      });
    }

    return res.status(500).json({ 
      msg: "Error al crear administrador",
      error: { code: "CREATION_ERROR" }
    });
  }
};

/**
 * Verificar sesión admin (para endpoints protegidos)
 */
const verificarSesionAdmin = async (req, res) => {
  try {
    // Esta función será llamada por requireAdmin middleware
    // Si llegamos aquí, significa que el middleware ya validó la autorización
    return res.json({
      msg: "Sesión admin válida",
      admin: req.admin || { method: "verified" },
      timestamp: Date.now()
    });
  } catch (error) {
    return res.status(500).json({ 
      msg: "Error al verificar sesión",
      error: { code: "VERIFICATION_ERROR" }
    });
  }
};

module.exports = { 
  loginAdmin, 
  registrarAdmin,
  verificarSesionAdmin
};