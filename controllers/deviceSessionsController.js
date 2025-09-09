// controllers/deviceSessionsController-1.js
// Cierre de sesiones en tiempo real vía Socket.IO.
// Funciona incluso entre distintos hosts (localhost / 127 / LAN) al emitir por user/session/family.

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const Usuario = require("../models/Usuario");

const { REFRESH_COOKIE_NAME } = require("../utils/jwt") || { REFRESH_COOKIE_NAME: (process.env.REFRESH_COOKIE_NAME || "rid") };

function getIO(req) {
  return req && req.app && req.app.get && req.app.get("io");
}

function isHttps(req) {
  return (req?.protocol === "https") || (req?.headers && String(req.headers["x-forwarded-proto"] || "").includes("https"));
}

function decodeRefreshFromCookie(req) {
  try {
    const raw = req.cookies && req.cookies[(process.env.REFRESH_COOKIE_NAME || "rid")];
    if (!raw) return null;
    return jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
    });
  } catch { return null; }
}


async function emitForceLogout(io, { uid, fam, jti, reason }) {
  try {
    if (!io) return;
    if (jti) io.to(`session:${jti}`).emit("session:forceLogout", { scope: "session", jti, reason });
    if (fam) io.to(`family:${fam}`).emit("session:forceLogout", { scope: "family", fam, reason });

    // Fallback: si el cliente no unió family/session (p. ej., autenticado solo por access token),
    // emitimos solo a los sockets del usuario cuya socket.data.fam coincida.
    if (uid && fam) {
      try {
        const sockets = await io.in(`user:${uid}`).fetchSockets();
        for (const s of sockets) {
          if (s?.data && s.data.fam === fam) {
            s.emit("session:forceLogout", { scope: "family", fam, reason, via: "fetchSockets" });
          }
        }
      } catch { }
    }

    // Fallback adicional: buscar por jti exacto entre TODOS los sockets (último recurso)
    if (jti) {
      try {
        const all = await io.fetchSockets();
        for (const s of all) {
          if (s?.data && String(s.data.jti || "") === String(jti)) {
            s.emit("session:forceLogout", { scope: "session", jti, reason, via: "fetchSockets:all" });
          }
        }
      } catch { }
    }
  } catch { }
}


function clearRefreshCookie(req, res) {
  try {
    const https = isHttps(req);
    const isLocal = !https || req.hostname === "localhost" || req.hostname.startsWith("192.168.");

    const sameSite = isLocal ? "lax" : "none";
    const secure = !isLocal ? true : false;
    const domain = isLocal ? undefined : process.env.COOKIE_DOMAIN;

    // limpiar en "/" y también por compatibilidad en "/api"
    res.clearCookie(process.env.REFRESH_COOKIE_NAME || "rid", {
      httpOnly: true,
      sameSite,
      secure,
      path: "/",
      domain,
    });

    res.clearCookie(process.env.REFRESH_COOKIE_NAME || "rid", {
      httpOnly: true,
      sameSite,
      secure,
      path: "/api",
      domain,
    });
  } catch { }
}


async function listSessions(req, res) {
  try {
    const p = decodeRefreshFromCookie(req);
    const uid = (req?.usuario && (req.usuario._id || req.usuario.id)) || (p && p.uid);
    const currentJti = p && p.jti;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const docs = await RefreshToken.find({ userId: uid }).sort({ lastUsedAt: -1, createdAt: -1 }).lean();

    const sessions = docs.map(d => ({
      id: d.jti,
      jti: d.jti,
      family: d.family || d.fam || null,
      current: currentJti ? (String(d.jti) === String(currentJti)) : false,
      revokedAt: d.revokedAt || null,
      lastUsedAt: d.lastUsedAt || null,
      ip: d.ip || null,
      ua: d.ua || null,
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
      expiresAt: d.expiresAt || null,
    }));

    const now = Date.now();
    const active = sessions.filter(s => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > now));

    return res.json({ sessions: active });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudieron listar las sesiones" });
  }
}

async function revokeOne(req, res) {
  try {
    const p = decodeRefreshFromCookie(req);
    const uid = (req?.usuario && (req.usuario._id || req.usuario.id)) || (p && p.uid);
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const target = String(req.params.jti || req.params.id || "");
    if (!target) return res.status(400).json({ mensaje: "Falta jti" });

    // Revocar en DB
    const upd = await RefreshToken.updateOne(
      { userId: uid, jti: target, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] },
      { $set: { revokedAt: new Date() } }
    );

    // Obtener doc para saber family
    const doc = await RefreshToken.findOne({ userId: uid, jti: target }).lean();

    // Emitir WS de cierre dirigido
    const io = getIO(req);
    if (io) {
      const fam = doc && (doc.family || doc.fam);
      await emitForceLogout(io, { uid: uid, fam, jti: target, reason: "revoked" });
    }

    return res.json({ revoked: upd.modifiedCount || 0 });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudo cerrar la sesión" });
  }
}

async function revokeOthers(req, res) {
  try {
    const p = decodeRefreshFromCookie(req);
    const uid = (req?.usuario && (req.usuario._id || req.usuario.id)) || (p && p.uid);
    const currentJti = p && p.jti;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const docs = await RefreshToken.find({ userId: uid, jti: { $ne: currentJti }, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] }).lean();

    // Marcar como revocados
    await RefreshToken.updateMany(
      { userId: uid, jti: { $in: docs.map(d => d.jti) } },
      { $set: { revokedAt: new Date() } }
    );

    // Emitir por cada familia/sesión encontrada (no afectamos a la actual)
    const io = getIO(req);
    if (io) {
      const seenFam = new Set();
      for (const d of docs) {
        const fam = d && (d.family || d.fam);
        await emitForceLogout(io, { uid: uid, fam, jti: d && d.jti, reason: "revoked-others" });
        if (fam) seenFam.add(fam);
      }
    }

    return res.json({ revoked: docs.length });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudieron cerrar las otras sesiones" });
  }
}

async function revokeAll(req, res) {
  try {
    const p = decodeRefreshFromCookie(req);
    const uid = (req?.usuario && (req.usuario._id || req.usuario.id)) || (p && p.uid);
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const docs = await RefreshToken.find({ userId: uid, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] }).lean();

    // Revocar todo
    await RefreshToken.updateMany({ userId: uid }, { $set: { revokedAt: new Date() } });

    // Limpiar cookie local
    clearRefreshCookie(req, res);

    // Avisar a todos los sockets del usuario (incluida esta sesión)
    const io = getIO(req);
    if (io) {
      const sockets = await io.in(`user:${uid}`).fetchSockets();
      io.to(`user:${uid}`).emit("session:forceLogout", { scope: "user", uid: String(uid), reason: "revoked-all" });
      const seenFam = new Set();
      for (const d of docs) {
        await emitForceLogout(io, { uid: uid, fam: d && (d.family || d.fam), jti: d && d.jti, reason: "revoked-all" });
      }
    }

    try {
      await Usuario.updateOne({ _id: uid }, { $set: { logoutAt: new Date() } });
    } catch { }

    return res.json({ revoked: docs.length });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudieron cerrar todas las sesiones" });
  }
}

module.exports = { listSessions, revokeOne, revokeOthers, revokeAll };