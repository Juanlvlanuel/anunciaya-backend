// ✅ server.js (final para producción/local)
require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server: SocketIOServer } = require("socket.io");

// DB y rutas existentes
const connectDB = require("./config/db");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");
const usuarioRoutes = require("./routes/usuarioRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
const promocionesRoutes = require("./routes/promocionesRoutes");
const rifasRoutes = require("./routes/rifasRoutes");

// ✅ Rutas nuevas (chat + upload)
const chatRoutes = require("./routes/chatRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

// ✅ Socket handler
const { registerChatSocket } = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);

// ---------- CORS (local + prod + previews vercel) ----------
const defaultAllowed = [
  "http://localhost:5173",
  "https://anunciaya-frontend.vercel.app",
];
const extraFromEnv = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [...new Set([...defaultAllowed, ...extraFromEnv])];

function isAllowedOrigin(origin) {
  if (!origin) return true; // Postman/cURL
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // permitir previews de vercel: https://*.vercel.app
  if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin: (origin, cb) =>
      isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("CORS bloqueado: " + origin)),
    optionsSuccessStatus: 200,
  })
);

// ---------- Socket.io con el mismo CORS ----------
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) =>
      isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("WS CORS bloqueado: " + origin)),
    methods: ["GET", "POST"],
  },
});

// ---------- Middlewares ----------
app.use(express.json({ limit: "2mb" }));

// ---------- Conexión a Mongo ----------
connectDB();

// ---------- Rutas existentes ----------
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/logos-carousel", logosCarouselRoutes);
app.use("/api/promociones", promocionesRoutes);
app.use("/api/rifas", rifasRoutes);
app.use("/api/contenido/local", contenidoLocalRoutes);

// ---------- NUEVAS RUTAS: Chat + Upload ----------
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);

// ---------- Estáticos: /uploads (chat imágenes/archivos) ----------
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------- Healthcheck ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- Socket events ----------
io.on("connection", (socket) => {
  registerChatSocket(io, socket);
});

// ---------- Start ----------
const PORT = process.env.PORT || 5000;
// ¡OJO! server.listen (no app.listen) para socket.io
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  console.log(`[CORS] Allowed: ${ALLOWED_ORIGINS.join(", ") || "(default)"}`);
});
