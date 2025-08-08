// server.js
require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server: SocketIOServer } = require("socket.io");

// DB + rutas
const connectDB = require("./config/db");
const usuarioRoutes = require("./routes/usuarioRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
const promocionesRoutes = require("./routes/promocionesRoutes");
const rifasRoutes = require("./routes/rifasRoutes");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");

// Chat + upload
const chatRoutes = require("./routes/chatRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

// Socket handler
const { registerChatSocket } = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);

// ----- CORS (REST + WS) -----
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
  // Previews de Vercel: https://*.vercel.app
  if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("CORS bloqueado: " + origin)),
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: "5mb" }));
connectDB();

// Rutas API
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/logos-carousel", logosCarouselRoutes);
app.use("/api/promociones", promocionesRoutes);
app.use("/api/rifas", rifasRoutes);
app.use("/api/contenido/local", contenidoLocalRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);

// Estáticos para archivos subidos del chat
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Healthcheck
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Socket.io con mismo CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("WS CORS bloqueado: " + origin)),
    methods: ["GET","POST"],
  },
});

io.on("connection", (socket) => registerChatSocket(io, socket));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 API + WS en puerto ${PORT}`);
  console.log(`[CORS] Allowed: ${ALLOWED_ORIGINS.join(", ") || "(default)"}`);
});
