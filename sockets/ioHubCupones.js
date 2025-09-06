// sockets/ioHubCupones-1.js
// Buffer de cupones + verificación periódica contra DB.
// Si un cupón fue borrado manualmente en Mongo o ya expiró, se emite `cupones:removed` y se purga del buffer.

let io = null;
let recent = []; // [{ id, titulo, etiqueta, colorHex, expiresAt, publishedAt, serverNow }]
const MAX_BUFFER = 50;
const VERIFY_INTERVAL_MS = 15000;

const Cupon = require("../models/Cupon");

function registerCuponesSocket(_io) {
  io = _io;

  io.on("connection", (socket) => {
    const now = Date.now();
    // Purga rápida local antes de enviar al cliente
    recent = recent.filter((x) => (x?.expiresAt || 0) > now);

    const fresh = recent.filter((x) => (x?.expiresAt || 0) > now);
    if (fresh.length) {
      socket.emit("cupones:recent", { items: fresh, serverNow: now });
    }

    socket.on("cupones:getRecent", () => {
      const now2 = Date.now();
      const fresh2 = recent.filter((x) => (x?.expiresAt || 0) > now2);
      socket.emit("cupones:recent", { items: fresh2, serverNow: now2 });
    });
  });
}

// Verificación periódica: elimina del buffer IDs inexistentes o expirados
async function verifyRecent() {
  try {
    if (!recent.length) return;
    const now = Date.now();

    // Separa expirados por tiempo (sin consultar DB)
    const stillValid = [];
    const expiredOrGone = [];
    for (const item of recent) {
      if ((item?.expiresAt || 0) <= now) {
        expiredOrGone.push(item);
      } else {
        stillValid.push(item);
      }
    }
    recent = stillValid;

    // IDs aún válidos por tiempo → revisar si existen en DB y siguen activos/publicados
    const ids = stillValid.map((x) => x.id).filter(Boolean);
    if (!ids.length) {
      // Emitir removidos por expiración
      for (const it of expiredOrGone) {
        if (io) io.emit("cupones:removed", { id: String(it.id) });
      }
      return;
    }

    // Traer existentes
    const rows = await Cupon.find(
      { _id: { $in: ids }, activa: true, estado: "publicado" },
      { _id: 1 }
    ).lean();
    const existSet = new Set(rows.map((r) => String(r._id)));

    // Los que ya NO existen o dejaron de estar activos/publicados
    const toRemove = [];
    for (const it of stillValid) {
      const idStr = String(it.id);
      if (!existSet.has(idStr)) toRemove.push(it);
    }

    if (toRemove.length) {
      // Purga local
      const toRemoveSet = new Set(toRemove.map((x) => String(x.id)));
      recent = recent.filter((x) => !toRemoveSet.has(String(x.id)));
      // Broadcast
      if (io) {
        for (const it of toRemove) {
          io.emit("cupones:removed", { id: String(it.id) });
        }
      }
    }

    // Emitir removidos por expiración
    if (expiredOrGone.length && io) {
      for (const it of expiredOrGone) {
        io.emit("cupones:removed", { id: String(it.id) });
      }
    }
  } catch (_) {}
}

setInterval(() => { verifyRecent(); }, VERIFY_INTERVAL_MS);

function emitCuponNew(payload) {
  if (!payload) return;
  const now = Date.now();
  // purga expirados del buffer
  recent = recent.filter((x) => (x?.expiresAt || 0) > now);
  // agrega al frente
  recent.unshift(payload);
  if (recent.length > MAX_BUFFER) recent.length = MAX_BUFFER;
  // broadcast a clientes
  if (io) io.emit("cupones:new", payload);
}

function emitCuponRemoved(payload) {
  if (!payload) return;
  const id = String(payload.id || "");
  if (!id) return;
  // Purga del buffer
  recent = recent.filter((x) => String(x.id) !== id);
  // Broadcast
  if (io) io.emit("cupones:removed", { id });
}

module.exports = { registerCuponesSocket, emitCuponNew, emitCuponRemoved };
