// controllers/_usuario.shared.js
// Helpers y utilidades compartidas por controladores de usuario.
// (Extraído de tu usuarioController actual, sin cambiar lógica.)

const Usuario = require("../models/Usuario");
const { Types } = require("mongoose");

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";
const { signAccess, signRefresh } = require("../helpers/tokens");

const isLocalhost = (req) => {
  const host = String(req.headers?.host || "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1";
};

const isHttps = (req) => {
  return !!(req?.secure || String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase() === "https");
};

const setRefreshCookie = (req, res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api",
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 días
  });
};

/* Helpers */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (v) => (v ?? "").toString().trim();
const normEmail = (v) => norm(v).toLowerCase();
const isValidObjectId = (id) => Types.ObjectId.isValid(String(id || ""));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractTipoPerfil = (raw) => {
  let t = norm(raw?.tipo);
  let p = norm(raw?.perfil);
  if (p && typeof p === "object" && "perfil" in p) p = p.perfil;
  if (typeof p === "string" && (p.trim().startsWith("{") || p.trim().startsWith("["))) {
    try { const parsed = JSON.parse(p); p = parsed?.perfil ?? parsed; } catch { }
  }
  if (typeof p === "string") p = p.trim();
  if (typeof p === "string" && /^\d+$/.test(p)) p = Number(p);
  if (p == null || p === "") p = 1;
  if (!t) t = "usuario";
  return { tipo: t, perfil: p };
};

const normalizePerfilToSchema = (valor) => {
  if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
  return valor;
};

module.exports = {
  Usuario,
  Types,
  signAccess,
  signRefresh,
  setRefreshCookie,
  EMAIL_RE,
  norm,
  normEmail,
  isValidObjectId,
  escapeRegExp,
  extractTipoPerfil,
  normalizePerfilToSchema,
  isLocalhost,
  isHttps,
};
