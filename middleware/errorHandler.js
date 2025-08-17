"use strict";

/**
 * Error helpers: build a consistent error payload.
 * `code` is optional: we include it when we can classify the error.
 */

function buildError({ code, message, details }) {
  const payload = { error: { message } };
  if (code) payload.error.code = code;
  if (details) payload.error.details = details;
  return payload;
}

function notFoundHandler(_req, res, _next) {
  return res.status(404).json(buildError({ code: "NOT_FOUND", message: "Recurso no encontrado" }));
}

function isMongoDuplicate(err) {
  return (err && (err.code === 11000 || err.code === 11001)) || /duplicate key/i.test(String(err && err.message));
}

function mapKnownError(err) {
  if (!err) return null;

  // 1) JSON parse error must be detected BEFORE generic 400 mapping
  if (err instanceof SyntaxError && /JSON/.test(String(err.message))) {
    return { status: 400, code: "MALFORMED_JSON", message: "El formato de los datos enviados no es válido. Revisa que todos los campos esten bien escritos." };
  }

  // 2) CORS origin blocked (from custom CORS callback)
  if (/CORS bloqueado/i.test(String(err && err.message))) {
    return { status: 403, code: "CORS_BLOCKED", message: "Origen no permitido por CORS" };
  }

  // 3) Mongo/Mongoose
  if (isMongoDuplicate(err)) {
    return { status: 409, code: "DUPLICATE", message: "Recurso duplicado" };
  }

  if (err && err.name === "CastError") {
    return { status: 400, code: "INVALID_ID", message: "Identificador inválido" };
  }

  if (err && err.name === "ValidationError") {
    const details = Object.values(err.errors || {}).map(e => ({
      path: e.path,
      message: e.message,
      kind: e.kind
    }));
    return { status: 422, code: "VALIDATION_ERROR", message: "Datos inválidos", details };
  }

  // 4) Multer/file validation patterns (if used)
  if (err && (err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_PART_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Carga de archivo excede los límites" };
  }

  // 5) Explicit status after special cases, keep optional code/message
  const statusFromErr = Number(err.status || err.statusCode);
  if (!Number.isNaN(statusFromErr) && statusFromErr >= 400 && statusFromErr <= 599) {
    switch (statusFromErr) {
      case 400: return { status: 400, code: err.code || "BAD_REQUEST", message: err.message || "Solicitud inválida" };
      case 401: return { status: 401, code: err.code || "UNAUTHORIZED", message: err.message || "No autorizado" };
      case 403: return { status: 403, code: err.code || "FORBIDDEN", message: err.message || "Prohibido" };
      case 404: return { status: 404, code: err.code || "NOT_FOUND", message: err.message || "Recurso no encontrado" };
      case 405: return { status: 405, code: err.code || "METHOD_NOT_ALLOWED", message: err.message || "Método no permitido" };
      case 409: return { status: 409, code: err.code || "DUPLICATE", message: err.message || "Conflicto de datos" };
      case 415: return { status: 415, code: err.code || "UNSUPPORTED_MEDIA_TYPE", message: err.message || "Tipo de contenido no soportado" };
      case 422: return { status: 422, code: err.code || "VALIDATION_ERROR", message: err.message || "Error de validación" };
      case 429: return { status: 429, code: err.code || "RATE_LIMITED", message: err.message || "Demasiadas solicitudes" };
      default:  return { status: statusFromErr, code: err.code, message: err.message || "Error" };
    }
  }

  // 6) Nothing recognized
  return null;
}

function errorHandler(err, _req, res, _next) {
  const isProd = process.env.NODE_ENV === "production";

  const mapped = mapKnownError(err);
  if (mapped) {
    const { status, code, message, details } = mapped;
    return res.status(status).json(buildError({ code, message, details }));
  }

  // Hide stack and internal messages in production
  const message = isProd ? "Error interno" : (err && err.message) || "Error interno";
  return res.status(500).json(buildError({ message }));
}

module.exports = { notFoundHandler, errorHandler };
