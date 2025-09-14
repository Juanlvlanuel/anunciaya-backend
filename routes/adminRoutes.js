// routes/adminRoutes.js - Sistema Admin con Niveles y Permisos
const express = require("express");
const router = express.Router();
const Admin = require("../models/Admin"); // CORREGIDO: Importar al inicio
const { loginAdmin, registrarAdmin, verificarSesionAdmin } = require("../controllers/adminAuthController");
const { 
  requireAdmin, 
  requireAdminLevel, 
  requirePermission, 
  requireResourceAccess 
} = require("../middleware/requireAdmin");
const verificarToken = require("../middleware/verificarToken");

// Rate limiting
const rateLimit = ({ windowMs = 60_000, max = 10 } = {}) => {
  const hits = new Map();
  return (req, res, next) => {
    const key = (req.ip || req.connection?.remoteAddress || "unknown") + "|" + (req.baseUrl + req.path);
    const now = Date.now();
    const rec = hits.get(key);
    
    if (!rec || rec.expires < now) {
      hits.set(key, { count: 1, expires: now + windowMs });
      return next();
    }
    
    if (rec.count >= max) {
      const retryAfter = Math.ceil((rec.expires - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ 
        error: "Demasiadas solicitudes, intenta más tarde.",
        retryAfter 
      });
    }
    
    rec.count += 1;
    return next();
  };
};

// Middleware de seguridad
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

router.use(express.json({ limit: "1mb" }));
router.use((req, res, next) => {
  const method = (req.method || "").toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({ error: "Content-Type debe ser application/json" });
    }
  }
  next();
});

// ===== AUTENTICACIÓN ADMIN =====
router.post("/login", rateLimit({ windowMs: 60_000, max: 5 }), loginAdmin);

// Solo super admins pueden crear otros admins
router.post("/registro", 
  rateLimit({ windowMs: 60_000, max: 3 }),
  requirePermission("admins:create"),  // <-- Este middleware ya maneja API Key
  registrarAdmin
);

router.get("/session", verificarToken, requireAdmin, verificarSesionAdmin);

// ===== GESTIÓN DE USUARIOS =====
// Ver usuarios - Todos los admins
router.get("/api/users", 
  requirePermission("users:read"), 
  (req, res) => {
    res.json({ 
      msg: "Listado de usuarios",
      adminLevel: req.admin.nivel,
      permissions: req.admin.permisos
    });
  }
);

// Crear/Editar usuarios - Admin general o superior
router.post("/api/users", 
  requirePermission("users:create"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  (req, res) => {
    res.json({ 
      msg: "Crear usuario",
      data: req.body 
    });
  }
);

router.put("/api/users/:id", 
  requirePermission("users:update"),
  (req, res) => {
    res.json({ 
      msg: "Actualizar usuario",
      userId: req.params.id,
      data: req.body 
    });
  }
);

// Eliminar usuarios - Solo super admin
router.delete("/api/users/:id", 
  requirePermission("users:delete"),
  (req, res) => {
    res.json({ 
      msg: "Eliminar usuario",
      userId: req.params.id 
    });
  }
);

// ===== GESTIÓN DE ACCIONES (CONFIGURACIÓN HOME) =====
// Ver acciones - Todos los admins
router.get("/api/actions", 
  requirePermission("actions:read"), 
  (req, res) => {
    res.json({ 
      msg: "Listado de acciones del home",
      actions: [],
      canEdit: req.admin.tienePermiso("actions:update"),
      canDelete: req.admin.tienePermiso("actions:delete")
    });
  }
);

// Crear acciones - Admin general o superior
router.post("/api/actions", 
  requirePermission("actions:create"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  (req, res) => {
    res.json({ 
      msg: "Crear nueva acción",
      data: req.body 
    });
  }
);

// Editar acciones - Admin general o superior
router.put("/api/actions/:id", 
  requirePermission("actions:update"),
  (req, res) => {
    res.json({ 
      msg: "Actualizar acción",
      actionId: req.params.id,
      data: req.body 
    });
  }
);

// Eliminar acciones - Admin general o superior
router.delete("/api/actions/:id", 
  requirePermission("actions:delete"),
  (req, res) => {
    res.json({ 
      msg: "Eliminar acción",
      actionId: req.params.id 
    });
  }
);

// ===== GESTIÓN DE PERFILES =====
// Ver perfiles - Todos los admins
router.get("/api/profiles", 
  requirePermission("profiles:read"), 
  (req, res) => {
    res.json({ 
      msg: "Listado de perfiles de usuario",
      profiles: [],
      canEdit: req.admin.tienePermiso("profiles:update")
    });
  }
);

// Asignar acciones a perfiles - Admin general o superior
router.post("/api/profiles/:profileId/actions", 
  requirePermission("profiles:update"),
  (req, res) => {
    res.json({ 
      msg: "Asignar acciones a perfil",
      profileId: req.params.profileId,
      actions: req.body.actions 
    });
  }
);

// ===== CONFIGURACIÓN DEL SISTEMA =====
// Solo super admins pueden ver/modificar configuración del sistema
router.get("/api/system/config", 
  requirePermission("system:read"), 
  (req, res) => {
    res.json({ 
      msg: "Configuración del sistema",
      config: {
        // Configuraciones globales
      }
    });
  }
);

router.put("/api/system/config", 
  requirePermission("system:update"),
  (req, res) => {
    res.json({ 
      msg: "Actualizar configuración del sistema",
      data: req.body 
    });
  }
);

// ===== GESTIÓN DE OTROS ADMINISTRADORES =====
// Listar admins - Solo super admin
router.get("/api/admins", 
  requirePermission("admins:read"), 
  async (req, res) => {
    try {
      // CORREGIDO: Ya no importar Admin aquí, usar la importación del inicio
      const admins = await Admin.find({}).select("-contraseña");
      res.json({ 
        msg: "Listado de administradores",
        admins,
        currentAdmin: {
          id: req.admin.id,
          nivel: req.admin.nivel
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Error al obtener administradores" });
    }
  }
);

// Actualizar nivel de admin - Solo super admin
router.put("/api/admins/:id", 
  requirePermission("admins:update"),
  async (req, res) => {
    try {
      const { nivel, activo } = req.body;
      
      // No permitir auto-modificación del nivel
      if (req.params.id === req.admin.id.toString()) {
        return res.status(400).json({ 
          error: "No puedes modificar tu propio nivel" 
        });
      }
      
      const admin = await Admin.findByIdAndUpdate(
        req.params.id,
        { nivel, activo },
        { new: true, runValidators: true }
      ).select("-contraseña");
      
      res.json({ 
        msg: "Administrador actualizado",
        admin 
      });
    } catch (error) {
      res.status(500).json({ error: "Error al actualizar administrador" });
    }
  }
);

// Eliminar admin - Solo super admin
router.delete("/api/admins/:id", 
  requirePermission("admins:delete"),
  async (req, res) => {
    try {
      // No permitir auto-eliminación
      if (req.params.id === req.admin.id.toString()) {
        return res.status(400).json({ 
          error: "No puedes eliminar tu propia cuenta" 
        });
      }
      
      await Admin.findByIdAndDelete(req.params.id);
      res.json({ msg: "Administrador eliminado" });
    } catch (error) {
      res.status(500).json({ error: "Error al eliminar administrador" });
    }
  }
);

// ===== ENDPOINTS DE INFORMACIÓN =====
// Info sobre permisos del admin actual
router.get("/api/me", 
  requireAdmin, 
  (req, res) => {
    res.json({
      admin: {
        id: req.admin.id,
        usuario: req.admin.usuario,
        nivel: req.admin.nivel,
        permisos: req.admin.permisos,
        method: req.admin.method
      }
    });
  }
);

// Test de niveles
router.get("/test/levels", (req, res) => {
  res.json({
    msg: "Prueba de niveles de admin",
    levels: {
      moderador: "Solo lectura",
      general: "Gestión de contenido",
      super: "Acceso total"
    }
  });
});

// Test específico por nivel
router.get("/test/super", 
  requireAdminLevel("super"), 
  (req, res) => {
    res.json({ msg: "Acceso super admin confirmado" });
  }
);

router.get("/test/general", 
  requireAdminLevel("general"), 
  (req, res) => {
    res.json({ msg: "Acceso admin general o superior confirmado" });
  }
);

module.exports = router;