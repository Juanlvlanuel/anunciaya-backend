// ===== requireAdmin.js - ARCHIVO COMPLETO CORREGIDO =====
// middleware/requireAdmin.js - CORREGIDO: Versión que funciona
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Admin = require("../models/Admin");

function safeEqual(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length != bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Middleware base para verificar autenticación admin
 */
const requireAdmin = async (req, res, next) => {
  try {
    // CORREGIDO: Eliminar verificación de req.usuario - los admins son independientes
    
    // Si ya es admin validado, continuar
    if (req.admin === true) { 
      return next(); 
    }

    // Verificar API Key (para super admins)
    const envKey = (process.env.ADMIN_API_KEY || "").trim();
    const headerKey = (
      req.headers["x-admin-key"] ||
      req.headers["X-Admin-Key"] ||
      req.get?.("x-admin-key") ||
      ""
    ).toString().trim();

    if (envKey && headerKey && safeEqual(headerKey, envKey)) {
      // API Key otorga privilegios de super admin
      req.admin = { 
        method: "api-key", 
        nivel: "super",
        permisos: ["*"], // Todos los permisos
        tienePermiso: () => true,
        puedeGestionar: () => true
      };
      return next();
    }

    // Verificar JWT Token
    let token = req.headers["authorization"] || "";
    if (typeof token === "string") token = token.trim();
    if (token.toLowerCase().startsWith("bearer ")) token = token.slice(7).trim();
    
    if (!token) {
      return res.status(401).json({ 
        error: { 
          code: "UNAUTHORIZED", 
          message: "Token admin requerido" 
        } 
      });
    }

    // Verificar token JWT
    const options = {};
    if (process.env.JWT_ISS) options.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) options.audience = process.env.JWT_AUD;

    let decoded = null;
    const secrets = [
      process.env.JWT_SECRET,
      process.env.ACCESS_JWT_SECRET,
    ].filter(Boolean);

    for (const sec of secrets) {
      if (decoded) break;
      try {
        decoded = jwt.verify(token, sec, options);
      } catch {}
    }

    if (!decoded) {
      return res.status(401).json({ 
        error: { 
          code: "UNAUTHORIZED", 
          message: "Token admin inválido" 
        } 
      });
    }

    // Verificar si tiene rol admin en el token
    const hasAdminInToken = 
      decoded.role === "admin" ||
      decoded.isAdmin === true ||
      (Array.isArray(decoded.scope) && decoded.scope.includes("admin"));

    if (!hasAdminInToken) {
      return res.status(403).json({ 
        error: { 
          code: "FORBIDDEN", 
          message: "Se requiere rol admin" 
        } 
      });
    }

    // Buscar admin completo en BD para obtener nivel y permisos
    const adminId = decoded.uid || decoded.id || decoded._id || decoded.sub;
    const admin = await Admin.findById(adminId).select("usuario nivel permisos activo ultimoAcceso");

    if (!admin || !admin.activo) {
      return res.status(403).json({ 
        error: { 
          code: "FORBIDDEN", 
          message: "Cuenta admin inactiva o no encontrada" 
        } 
      });
    }

    // Actualizar último acceso
    admin.ultimoAcceso = new Date();
    await admin.save();

    // Establecer información admin en request
    req.admin = {
      method: "jwt",
      id: admin._id,
      usuario: admin.usuario,
      nivel: admin.nivel,
      permisos: admin.permisos,
      tienePermiso: (permiso) => {
        return admin.activo && admin.permisos.includes(permiso);
      },
      puedeGestionar: (recurso) => {
        const acciones = ["read", "create", "update", "delete"];
        return acciones.some(accion => 
          admin.activo && admin.permisos.includes(`${recurso}:${accion}`)
        );
      }
    };

    return next();

  } catch (error) {
    return res.status(500).json({ 
      error: { 
        code: "INTERNAL_ERROR", 
        message: "Error de verificación admin" 
      } 
    });
  }
};

/**
 * CORREGIDO: Middleware para requerir nivel específico de admin
 */
const requireAdminLevel = (nivelRequerido) => {
  const jerarquia = {
    "moderador": 1,
    "general": 2,
    "super": 3
  };

  return (req, res, next) => {
    // Primero ejecutar requireAdmin
    requireAdmin(req, res, (err) => {
      if (err) {
        return; // requireAdmin ya envió la respuesta
      }

      if (!req.admin) {
        return res.status(403).json({ 
          error: { 
            code: "FORBIDDEN", 
            message: "Admin requerido" 
          } 
        });
      }

      // API Key tiene acceso total
      if (req.admin.method === "api-key") {
        return next();
      }

      const nivelActual = req.admin.nivel;
      const nivelActualNum = jerarquia[nivelActual] || 0;
      const nivelRequeridoNum = jerarquia[nivelRequerido] || 999;

      if (nivelActualNum < nivelRequeridoNum) {
        return res.status(403).json({ 
          error: { 
            code: "INSUFFICIENT_LEVEL", 
            message: `Se requiere nivel ${nivelRequerido} o superior`,
            currentLevel: nivelActual,
            requiredLevel: nivelRequerido
          } 
        });
      }

      return next();
    });
  };
};

/**
 * CORREGIDO: Middleware para requerir permiso específico
 */
const requirePermission = (permiso) => {
  return (req, res, next) => {
    // Primero ejecutar requireAdmin
    requireAdmin(req, res, (err) => {
      if (err) {
        return; // requireAdmin ya envió la respuesta
      }

      if (!req.admin) {
        return res.status(403).json({ 
          error: { 
            code: "FORBIDDEN", 
            message: "Admin requerido" 
          } 
        });
      }

      // API Key tiene todos los permisos
      if (req.admin.method === "api-key") {
        return next();
      }

      if (!req.admin.tienePermiso(permiso)) {
        return res.status(403).json({ 
          error: { 
            code: "INSUFFICIENT_PERMISSIONS", 
            message: `Permiso requerido: ${permiso}`,
            currentPermissions: req.admin.permisos
          } 
        });
      }

      return next();
    });
  };
};

/**
 * CORREGIDO: Middleware para verificar si puede gestionar un recurso
 */
const requireResourceAccess = (recurso) => {
  return (req, res, next) => {
    requireAdmin(req, res, (err) => {
      if (err) {
        return;
      }

      if (!req.admin) {
        return res.status(403).json({ 
          error: { 
            code: "FORBIDDEN", 
            message: "Admin requerido" 
          } 
        });
      }

      if (req.admin.method === "api-key") {
        return next();
      }

      if (!req.admin.puedeGestionar(recurso)) {
        return res.status(403).json({ 
          error: { 
            code: "RESOURCE_ACCESS_DENIED", 
            message: `Sin acceso al recurso: ${recurso}`
          } 
        });
      }

      return next();
    });
  };
};

module.exports = {
  requireAdmin,
  requireAdminLevel,
  requirePermission,
  requireResourceAccess
};