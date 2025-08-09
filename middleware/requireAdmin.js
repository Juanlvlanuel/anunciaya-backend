// middleware/requireAdmin.js
const jwt = require("jsonwebtoken");

/**
 * Autoriza llamadas de ADMIN de dos formas:
 * 1) Header: x-admin-key === process.env.ADMIN_API_KEY
 * 2) Authorization: Bearer <JWT> con { role: 'admin' } o { isAdmin: true }
 */
module.exports = function requireAdmin(req, res, next) {
  // ---- API KEY (x-admin-key) ----
  const envKey = (process.env.ADMIN_API_KEY || "").trim();
  // Postman/Navegador pueden mandar el header en minúsculas o con espacios
  const headerKey =
    (req.headers["x-admin-key"] ||
      req.headers["X-Admin-Key"] ||
      req.get?.("x-admin-key") ||
      "").toString().trim();

  // Logs de diagnóstico (borra estas líneas cuando termines de probar)
  console.log("🔍 ADMIN_API_KEY (.env) =", envKey ? "(definida)" : "(vacía)");
  console.log("🔍 Header x-admin-key   =", headerKey || "(no enviado)");

  if (envKey && headerKey && headerKey === envKey) {
    req.admin = { method: "api-key" };
    return next();
  }

  // ---- JWT (Authorization: Bearer <token>) ----
  let token = req.headers["authorization"] || "";
  if (token.startsWith("Bearer ")) token = token.slice(7).trim();

  if (!token) {
    return res.status(401).json({ error: "Admin no autorizado" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded && (decoded.role === "admin" || decoded.isAdmin === true)) {
      req.admin = { method: "jwt", ...decoded };
      return next();
    }
    return res.status(403).json({ error: "Se requiere rol admin" });
  } catch (e) {
    return res.status(401).json({ error: "Token admin inválido" });
  }
};
