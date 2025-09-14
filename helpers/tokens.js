// helpers/tokens-1.js
const jwt = require("jsonwebtoken");
const { randomBytes, createHash } = require("crypto");

let RefreshToken;
try {
  RefreshToken = require("../models/RefreshToken");
} catch (_) {
  RefreshToken = null;
}

const ISS = process.env.JWT_ISS;
const AUD = process.env.JWT_AUD;

// === util local: hash seguro del token (sha256 en hex) ===
function hashToken(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
}

// Guarda el refresh en DB si hay modelo disponible (soporta create() o new Model())
async function persistRefresh(doc) {
  if (!RefreshToken) return null;
  try {
    if (typeof RefreshToken.create === "function") {
      return await RefreshToken.create(doc);
    }
    if (typeof RefreshToken === "function") {
      const d = new RefreshToken(doc);
      if (typeof d.save === "function") return await d.save();
    }
  } catch (_) {
    // ignorar errores para que no rompa el login si el modelo cambia
  }
  return null;
}

// === Validación explícita de variables de entorno ===
function assertEnvSecrets() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET no está definido en el entorno");
  }
  if (!process.env.REFRESH_JWT_SECRET) {
    throw new Error("REFRESH_JWT_SECRET no está definido en el entorno");
  }
}

function parseExpiresToSeconds(expStr) {
  const s = String(expStr || "15m").trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s,10);
  const m = s.match(/^(\d+)\s*([smhd])$/);
  if (!m) return 900;
  const n = parseInt(m[1],10);
  const unit = m[2];
  const map = { s:1, m:60, h:3600, d:86400 };
  return n * (map[unit] || 60);
}

// === Helper para detectar HTTPS ===
function isHttps(req) {
  if (req && req.secure) return true;
  const xfp = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return xfp === "https";
}

// === Helper para opciones de cookie ===
function getRefreshCookieOpts(req) {
  const https = isHttps(req);
  const secure = https ? true : false;
  const sameSite = https ? "none" : "lax";
  const cfg = (process.env.COOKIE_DOMAIN || "").trim().replace(/^\./, "");
  const host = String(req?.headers?.host || "").split(":")[0];
  const cookieDomain = (cfg && host && (host === cfg || host.endsWith("." + cfg))) ? cfg : undefined;
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    domain: cookieDomain,
  };
}

const signAccess = (uid) => {
  assertEnvSecrets();
  return jwt.sign({ uid }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    issuer: ISS,
    audience: AUD,
  });
};

const signRefresh = async (userId, family) => {
  assertEnvSecrets();

  const jti = randomBytes(16).toString("hex");
  const fam = family || randomBytes(16).toString("hex");

  const refresh = jwt.sign(
    { uid: String(userId), jti, fam },
    process.env.REFRESH_JWT_SECRET,
    {
      expiresIn: process.env.REFRESH_EXPIRES_IN || "30d",
      issuer: ISS,
      audience: AUD,
    }
  );

  const payload = jwt.decode(refresh);
  await persistRefresh({
    userId,
    jti,
    family: fam,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(payload.exp * 1000),
    revokedAt: null,
  });

  return { refresh, jti, family: fam };
};

const revokeFamily = async (family) => {
  if (!RefreshToken) return { n: 0 };
  try {
    if (typeof RefreshToken.updateMany === "function") {
      return await RefreshToken.updateMany(
        { family, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
  } catch (_) {}
  return { n: 0 };
};

// === Nueva función setRefreshCookie ===
const setRefreshCookie = async (res, userId, req = null) => {
  try {
    const { refresh } = await signRefresh(userId);
    const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";
    
    let cookieOpts;
    if (req) {
      cookieOpts = getRefreshCookieOpts(req);
    } else {
      // Fallback si no hay req
      cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/"
      };
    }
    
    res.cookie(REFRESH_COOKIE_NAME, refresh, cookieOpts);
    return refresh;
  } catch (e) {
    console.error("Error setting refresh cookie:", e);
    throw e;
  }
};

const getAccessTTLSeconds = () => parseExpiresToSeconds(process.env.JWT_EXPIRES_IN || "15m");

module.exports = { 
  signAccess, 
  signRefresh, 
  revokeFamily, 
  hashToken, 
  getAccessTTLSeconds,
  setRefreshCookie // ✨ Nueva función exportada
};