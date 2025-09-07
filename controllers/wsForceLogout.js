// controllers/wsForceLogout.js
// Utilidades para empujar "force-logout" a clientes conectados por Socket.IO
// No dependemos de rooms; filtramos por socket.data.uid/jti del handshake.

async function wsKickByUid(req, uid, exceptJti = null, payload = {}) {
  try {
    const io = req?.app?.get?.("io");
    if (!io || !uid) return 0;
    const sockets = await io.fetchSockets();
    let n = 0;
    for (const s of sockets) {
      const data = s.data || {};
      if (String(data.uid) === String(uid)) {
        if (exceptJti && String(data.jti) === String(exceptJti)) continue;
        s.emit("force-logout", payload || {});
        n++;
      }
    }
    return n;
  } catch (_) {
    return 0;
  }
}

async function wsKickBySession(req, jti, payload = {}) {
  try {
    const io = req?.app?.get?.("io");
    if (!io || !jti) return 0;
    const sockets = await io.fetchSockets();
    let n = 0;
    for (const s of sockets) {
      const data = s.data || {};
      if (String(data.jti) === String(jti)) {
        s.emit("force-logout", payload || {});
        n++;
      }
    }
    return n;
  } catch (_) {
    return 0;
  }
}

module.exports = { wsKickByUid, wsKickBySession };
