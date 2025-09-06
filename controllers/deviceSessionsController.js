// controllers/deviceSessionsController-1.js
// Lista y revoca sesiones con cierre instantáneo (targeting directo por socket jti/uid)
const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const Usuario = require("../models/Usuario");

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

function decodeRefresh(raw) {
  try {
    if (!raw) return null;
    const payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
    });
    return payload; // { jti, uid, iat, exp }
  } catch {
    return null;
  }
}

function wsEmit(req, room, event, payload) {
  try {
    const io = req.app && req.app.get && req.app.get("io");
    if (!io) return;
    if (Array.isArray(room)) {
      io.to(room).emit(event, payload);
    } else {
      io.to(String(room)).emit(event, payload);
    }
  } catch {}
}

function wsKickByJti(req, jti) {
  try {
    const io = req.app && req.app.get && req.app.get("io");
    if (!io) return;
    const sockets = io.sockets.sockets; // Map
    for (const [, s] of sockets) {
      const sjti = s && s.data && s.data.jti;
      if (sjti && sjti === jti) {
        s.emit("force-logout", { scope: "one", jti });
      }
    }
  } catch {}
}

function wsKickByUid(req, uid, exceptJti = null) {
  try {
    const io = req.app && req.app.get && req.app.get("io");
    if (!io) return;
    const sockets = io.sockets.sockets;
    for (const [, s] of sockets) {
      const suid = s && s.data && s.data.uid;
      const sjti = s && s.data && s.data.jti;
      if (!suid) continue;
      if (String(suid) !== String(uid)) continue;
      if (exceptJti && sjti && String(sjti) === String(exceptJti)) continue;
      s.emit("force-logout", { scope: "user", except: exceptJti || null });
    }
  } catch {}
}

// GET /api/usuarios/sessions
const listSessions = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const curr = decodeRefresh(req.cookies?.[REFRESH_COOKIE_NAME]) || null;
    const currentJti = curr?.jti || null;

    // Tocar metadata de la sesión actual
    if (currentJti) {
      const ua = String(req.headers["user-agent"] || "");
      const ip =
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.ip ||
        (req.connection && req.connection.remoteAddress) ||
        null;
      const now = new Date();
      try {
        await RefreshToken.updateOne(
          { jti: currentJti, userId: uid },
          { $set: { ua, ip, lastUsedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
      } catch {}
    }

    const tokens = await RefreshToken.find({
      userId: uid,
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
    })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .lean();

    const items = (tokens || []).map((t) => ({
      id: t.jti,
      createdAt: t.createdAt || null,
      lastUsedAt: t.lastUsedAt || null,
      ip: t.ip || null,
      ua: t.ua || null,
      current: currentJti && t.jti === currentJti,
    }));

    if (items.length === 0 && currentJti) {
      const ua = String(req.headers["user-agent"] || "");
      const ip =
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.ip ||
        (req.connection && req.connection.remoteAddress) ||
        null;
      items.push({
        id: currentJti,
        createdAt: null,
        lastUsedAt: new Date(),
        ip,
        ua,
        current: true,
      });
    }

    return res.json({ sessions: items });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al listar sesiones" });
  }
};

// DELETE /api/usuarios/sessions/:jti
const revokeOne = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const target = String(req.params?.jti || "").trim();
    if (!target) return res.status(400).json({ mensaje: "Falta id de sesión" });

    const curr = decodeRefresh(req.cookies?.[REFRESH_COOKIE_NAME]) || null;
    const isCurrent = !!(curr && curr.jti && curr.jti === target);

    await RefreshToken.updateOne(
      { jti: target, userId: uid },
      { $set: { revokedAt: new Date() } }
    );

    // Señal al socket con ese JTI (targeting directo)
    wsKickByJti(req, target);
    // También por room (por si aplica)
    wsEmit(req, `session:${target}`, "force-logout", { scope: "one", jti: target });

    if (isCurrent) {
      const https =
        req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
      try {
        res.clearCookie(REFRESH_COOKIE_NAME, {
          httpOnly: true,
          sameSite: https ? "none" : "lax",
          secure: https,
          path: "/",
          domain: process.env.COOKIE_DOMAIN || undefined,
        });
      } catch {}
      try {
        await Usuario.updateOne({ _id: uid }, { $set: { logoutAt: new Date() } });
      } catch {}
    }

    return res.json({ revoked: true, jti: target });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudo revocar la sesión" });
  }
};

// POST /api/usuarios/sessions/revoke-others
const revokeOthers = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const curr = decodeRefresh(req.cookies?.[REFRESH_COOKIE_NAME]) || null;
    const currentJti = curr?.jti || null;

    const q = { userId: uid, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] };
    if (currentJti) q.jti = { $ne: currentJti };

    const { modifiedCount } = await RefreshToken.updateMany(q, {
      $set: { revokedAt: new Date() },
    });

    // Señal inmediata a todos los sockets del usuario excepto el actual
    wsKickByUid(req, uid, currentJti);

    try {
      await Usuario.updateOne({ _id: uid }, { $set: { logoutAt: new Date() } });
    } catch {}

    return res.json({ revoked: modifiedCount || 0 });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudieron revocar las otras sesiones" });
  }
};

// POST /api/usuarios/sessions/revoke-all
const revokeAll = async (req, res) => {
  try {
    const uid = req.usuario?._id || req.usuarioId;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const { modifiedCount } = await RefreshToken.updateMany(
      { userId: uid, $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }] },
      { $set: { revokedAt: new Date() } }
    );

    const https =
      req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    try {
      res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        sameSite: https ? "none" : "lax",
        secure: https,
        path: "/",
        domain: process.env.COOKIE_DOMAIN || undefined,
      });
    } catch {}

    try {
      await Usuario.updateOne({ _id: uid }, { $set: { logoutAt: new Date() } });
    } catch {}

    // Señal inmediata a todos los sockets del usuario (incluido el actual)
    wsKickByUid(req, uid, null);

    return res.json({ revoked: modifiedCount || 0 });
  } catch (e) {
    return res.status(500).json({ mensaje: "No se pudieron revocar las sesiones" });
  }
};

module.exports = { listSessions, revokeOne, revokeOthers, revokeAll };
