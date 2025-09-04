// utils/jwt.js
// Helpers centralizados para JWT y cookie de refresh
const jwt = require("jsonwebtoken");

const ACCESS_SECRET = process.env.ACCESS_JWT_SECRET || process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_JWT_SECRET;
const ISS = process.env.JWT_ISS || undefined;
const AUD = process.env.JWT_AUD || undefined;
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

if (!ACCESS_SECRET) {
  console.warn("[utils/jwt] Falta ACCESS_JWT_SECRET o JWT_SECRET");
}
if (!REFRESH_SECRET) {
  console.warn("[utils/jwt] Falta REFRESH_JWT_SECRET");
}

function baseOpts(extra = {}) {
  const opts = { ...extra };
  if (ISS) opts.issuer = ISS;
  if (AUD) opts.audience = AUD;
  return opts;
}

function signAccessToken(payload = {}, extra = {}) {
  const opts = baseOpts({ expiresIn: process.env.ACCESS_JWT_TTL || "15m", ...extra });
  return jwt.sign(payload, ACCESS_SECRET, opts);
}

function signRefreshToken(payload = {}, extra = {}) {
  const ttl = process.env.REFRESH_JWT_TTL || "30d";
  const opts = baseOpts({ expiresIn: ttl, ...extra });
  return jwt.sign(payload, REFRESH_SECRET, opts);
}

function verifyAccess(token) {
  const opts = baseOpts();
  try {
    return jwt.verify(token, ACCESS_SECRET, opts);
  } catch (e1) {
    // Fallback sin iss/aud por compatibilidad
    try { return jwt.verify(token, ACCESS_SECRET); } catch (e2) { return null; }
  }
}

function verifyRefresh(token) {
  const opts = baseOpts();
  try {
    return jwt.verify(token, REFRESH_SECRET, opts);
  } catch (e1) {
    try { return jwt.verify(token, REFRESH_SECRET); } catch (e2) { return null; }
  }
}

function setRefreshCookie(req, res, token) {
  if (!res || !token) return;
  const isProd = process.env.NODE_ENV === "production";
  const maxAgeMs = parseTtlToMs(process.env.REFRESH_COOKIE_MAXAGE || process.env.REFRESH_JWT_TTL || "30d");
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,           // en prod: true (HTTPS), en local: false
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  });
}

function clearRefreshCookie(req, res) {
  if (!res) return;
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });
}

function parseAuthHeader(header = "") {
  let t = String(header || "").trim();
  if (!t) return "";
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  else if (t.toLowerCase().startsWith("token ")) t = t.slice(6).trim();
  return t;
}

// Utilidad: convierte '30d'/'15m' a milisegundos
function parseTtlToMs(input = "30d") {
  const s = String(input).trim();
  const m = s.match(/^(\d+)([smhdw])$/i);
  if (!m) {
    // Si mandaron un número directo, interpretarlo como segundos
    const n = Number(s);
    return Number.isFinite(n) ? n * 1000 : 30 * 24 * 60 * 60 * 1000;
  }
  const val = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const map = { s: 1000, m: 60*1000, h: 60*60*1000, d: 24*60*60*1000, w: 7*24*60*60*1000 };
  return val * map[unit];
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccess,
  verifyRefresh,
  setRefreshCookie,
  clearRefreshCookie,
  parseAuthHeader,
  REFRESH_COOKIE_NAME,
};
