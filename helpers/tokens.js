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

module.exports = { signAccess, signRefresh, revokeFamily, hashToken };
