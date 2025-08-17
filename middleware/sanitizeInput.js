'use strict';

/**
 * sanitizeInput middleware
 * 
 * - Sanea req.body, req.query y req.params sin tocar campos sensibles (password/tokens).
 * - Elimina caracteres de control, zero-width y bidi, y limpia HTML/JS peligroso básico.
 * - Limita strings muy largos para evitar DoS (configurable).
 * - Con DEBUG_SANITIZE=1 agrega el header `X-Sanitized: <n>` con la cantidad de campos alterados.
 *
 * Uso:
 *   const sanitizeInput = require('./middleware/sanitizeInput');
 *   app.use(express.json());
 *   app.use(sanitizeInput({ maxLen: 2000, excludeFields: ['otroCampo'] }));
 */

const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'id_token',
  'idtoken',
  'rid',
  'jwt'
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Buffer);
}

function clampString(str, maxLen) {
  if (typeof maxLen === 'number' && maxLen > 0 && str.length > maxLen) {
    return str.slice(0, maxLen);
  }
  return str;
}

function sanitizeString(input, maxLen) {
  if (typeof input !== 'string') return input;

  let s = input;

  // Normaliza Unicode para evitar variantes engañosas (NFKC)
  try {
    s = s.normalize('NFKC');
  } catch (_) { /* ignore if not supported */ }

  // Elimina caracteres de control (excepto \n\r\t) y DEL
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Elimina zero-width y algunos bidi control chars
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

  // Quita bloques HTML peligrosos comunes
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');

  // Elimina atributos on*="..." y on*='...' y on*=sin comillas
  s = s.replace(/\son[a-z]+\s*=\s*"(?:\\.|[^"\\])*"/gi, '');  // on...="..."
  s = s.replace(/\son[a-z]+\s*=\s*'(?:\\.|[^'\\])*'/gi, '');  // on...='...'
  s = s.replace(/\son[a-z]+\s*=\s*[^>\s]+/gi, '');           // on...=valor

  // Quita javascript: en URLs/atributos
  s = s.replace(/\bjavascript\s*:/gi, '');

  // Colapsa espacios raros
  s = s.replace(/\s{3,}/g, ' ');

  // Limita longitud final
  s = clampString(s, maxLen);

  return s;
}

function buildExclusionSet(extra) {
  const set = new Set(DEFAULT_SENSITIVE_FIELDS.map(f => String(f).toLowerCase()));
  if (Array.isArray(extra)) {
    for (const f of extra) set.add(String(f).toLowerCase());
  }
  return set;
}

function sanitizeContainer(obj, excludeSet, options, counterRef) {
  if (obj == null) return;

  const { maxLen } = options;

  const visit = (value, keyName) => {
    // No tocar campos sensibles por nombre del campo (case-insensitive)
    if (keyName && excludeSet.has(String(keyName).toLowerCase())) {
      return value;
    }

    if (typeof value === 'string') {
      const cleaned = sanitizeString(value, maxLen);
      if (cleaned !== value) {
        counterRef.count++;
      }
      return cleaned;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = visit(value[i], keyName); // para arrays usamos el nombre del contenedor
      }
      return value;
    }

    if (isPlainObject(value)) {
      for (const k of Object.keys(value)) {
        value[k] = visit(value[k], k);
      }
      return value;
    }

    return value;
  };

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = visit(obj[i], null);
    }
  } else if (isPlainObject(obj)) {
    for (const k of Object.keys(obj)) {
      obj[k] = visit(obj[k], k);
    }
  }
}

module.exports = function sanitizeInput(options = {}) {
  const {
    excludeFields = [],
    maxLen = 2000
  } = options;

  const excludeSet = buildExclusionSet(excludeFields);

  return function sanitizeInputMiddleware(req, res, next) {
    const counterRef = { count: 0 };

    try { sanitizeContainer(req.body,   excludeSet, { maxLen }, counterRef); } catch (_) {}
    try { sanitizeContainer(req.query,  excludeSet, { maxLen }, counterRef); } catch (_) {}
    try { sanitizeContainer(req.params, excludeSet, { maxLen }, counterRef); } catch (_) {}

    if (process.env.DEBUG_SANITIZE && String(process.env.DEBUG_SANITIZE) !== '0') {
      try { res.setHeader('X-Sanitized', String(counterRef.count)); } catch (_) {}
    }

    return next();
  };
};
