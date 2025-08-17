// middleware/requireAdmin-1.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
function safeEqual(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length != bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Autoriza llamadas de ADMIN de dos formas:
 * 1) Header: x-admin-key === process.env.ADMIN_API_KEY
 * 2) Authorization: Bearer <JWT> con { role: 'admin' } o { isAdmin: true } o scope incluye 'admin'
 */
module.exports = function requireAdmin(req, res, next) {
  
  // Requiere JWT válido (verificarToken debe correr antes). Sin token => 401
  if (!req || !req.usuario) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No token. Acceso denegado" } });
  }
  // Si el token ya es admin, permitir
  if (req.admin === true) { return next(); }
// ---- API KEY (x-admin-key) ----
  if (req.admin === true) { return next(); }
  const envKey = (process.env.ADMIN_API_KEY || "").trim();
  const headerKey =
    (req.headers["x-admin-key"] ||
      req.headers["X-Admin-Key"] ||
      req.get?.("x-admin-key") ||
      "").toString().trim();

  if (envKey && headerKey && headerKey === envKey) {
    req.admin = { method: "api-key" };
    return next();
  }

  // ---- JWT (Authorization: Bearer <token>) ----
  let token = req.headers["authorization"] || "";
  if (typeof token === "string") token = token.trim();
  if (token.toLowerCase().startsWith("bearer ")) token = token.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Admin no autorizado" } });
  }

  try {
    const options = {};
    if (process.env.JWT_ISS) options.issuer = process.env.JWT_ISS;
    if (process.env.JWT_AUD) options.audience = process.env.JWT_AUD;

    // Permite verificación con JWT_SECRET y ACCESS_JWT_SECRET
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

    if (!decoded) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token admin inválido" } });

    const hasAdmin =
      decoded.role === "admin" ||
      decoded.isAdmin === true ||
      (Array.isArray(decoded.scope) && decoded.scope.includes("admin"));

    if (!hasAdmin) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Se requiere rol admin" } });

    req.admin = {
      method: "jwt",
      sub: decoded.sub,
      uid: decoded.uid || decoded.id || decoded._id,
      role: decoded.role || (decoded.isAdmin ? "admin" : undefined),
    };
    return next();
  } catch (_e) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token admin inválido" } });
  }
};
