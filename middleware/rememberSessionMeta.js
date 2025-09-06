// middleware/rememberSessionMeta-1.js
const jwt = require("jsonwebtoken");
let RefreshToken;
try { RefreshToken = require("../models/RefreshToken"); } catch { RefreshToken = null; }

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

function decodeRefreshFromReq(req) {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return null;
    const payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
    });
    return payload; // { uid, jti, fam, iat, exp }
  } catch { return null; }
}

async function touchFromCookie(req) {
  if (!RefreshToken) return null;
  try {
    const p = decodeRefreshFromReq(req);
    if (!p || !p.jti || !p.uid) return null;
    const ua = String(req.headers["user-agent"] || "");
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.connection?.remoteAddress || null;
    const now = new Date();
    const raw = req.cookies && req.cookies[REFRESH_COOKIE_NAME];
let incomingHash = null;
try { incomingHash = require("../helpers/tokens").hashToken(raw); } catch (_) {}
const set = { ua, ip, lastUsedAt: now };
if (incomingHash) set.tokenHash = incomingHash;
const setOnInsert = { createdAt: now };
if (p.fam) setOnInsert.family = p.fam;
if (p.exp) setOnInsert.expiresAt = new Date(p.exp * 1000);
await RefreshToken.updateOne(
  { jti: p.jti, userId: p.uid },
  { $set: set, $setOnInsert: setOnInsert },
  { upsert: true }
);
return { jti: p.jti, uid: p.uid };
  } catch { return null; }
}

const touchOnRequest = async (req, res, next) => {
  try { await touchFromCookie(req); } catch {}
  next();
};

module.exports = { touchOnRequest, touchFromCookie };
