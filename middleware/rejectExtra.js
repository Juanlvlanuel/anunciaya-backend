'use strict';

/**
 * Middleware que rechaza campos extra no listados en una whitelist.
 * Además valida que los tipos de los campos sean los esperados si se proporciona un mapa de tipos.
 * Uso:
 *   const { rejectExtra } = require('../middleware/rejectExtra');
 *   router.post('/login', rejectExtra(['email','password']), handler);
 *   router.post('/auth/refresh', rejectExtra([]), handler);
 *   router.post('/registro', rejectExtra({ email: 'string', password: 'string' }), handler);
 */
function normalizeWhitelist(list) {
  if (Array.isArray(list)) {
    return { allowed: list.map(String), typeMap: null };
  } else if (list && typeof list === 'object') {
    return { allowed: Object.keys(list).map(String), typeMap: list };
  }
  return { allowed: [], typeMap: null };
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function rejectExtra(config = []) {
  const { allowed, typeMap } = normalizeWhitelist(config);
  const white = new Set(allowed);
  return function (req, res, next) {
    try {
      // Solo aplica a JSON plano (ignora arrays, buffers, etc.)
      if (!isPlainObject(req.body)) return next();
      const extras = Object.keys(req.body).filter((k) => !white.has(k));
      if (extras.length) {
        return res.status(400).json({ error: `Campos no permitidos: ${extras.join(', ')}` });
      }
      if (typeMap) {
        for (const key of allowed) {
          if (key in req.body && typeof req.body[key] !== typeMap[key]) {
            return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Tipo inválido para el campo '${key}', esperado ${typeMap[key]}` } });
          }
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { rejectExtra };
