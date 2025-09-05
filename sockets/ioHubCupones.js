// sockets/ioHubCupones.js
// Mantiene un buffer de cupones recientes y emite eventos en tiempo real.

let io = null;
let recent = [];                // [{ id, titulo, etiqueta, colorHex, expiresAt, publishedAt, serverNow }]
const MAX_BUFFER = 50;

function registerCuponesSocket(_io) {
  io = _io;

  io.on("connection", (socket) => {
    // Al conectar, manda los recientes válidos (no expirados)
    const now = Date.now();
    const fresh = recent.filter((x) => (x?.expiresAt || 0) > now);
    if (fresh.length) {
      socket.emit("cupones:recent", { items: fresh, serverNow: now });
    }

    // Petición explícita desde el cliente
    socket.on("cupones:getRecent", () => {
      const now2 = Date.now();
      const fresh2 = recent.filter((x) => (x?.expiresAt || 0) > now2);
      socket.emit("cupones:recent", { items: fresh2, serverNow: now2 });
    });
  });
}

function emitCuponNew(payload) {
  if (!payload) return;
  const now = Date.now();
  recent = recent.filter((x) => (x?.expiresAt || 0) > now);
  recent.unshift(payload);
  if (recent.length > MAX_BUFFER) recent.length = MAX_BUFFER;
  if (io) io.emit("cupones:new", payload);
}

module.exports = { registerCuponesSocket, emitCuponNew };
