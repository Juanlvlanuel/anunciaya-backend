// server-1.js
require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // ✅ añadido
const helmet = require("helmet");
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

// Deep health routes
const healthRoutes = require("./routes/healthRoutes");

// Socket handler
const { registerChatSocket } = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);

// 🔒 Seguridad básica de Express
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Helmet: cabeceras de seguridad
app.use(helmet({ crossOriginResourcePolicy: false }));

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
  credentials: true,
}));

app.use(cookieParser()); // ✅ necesario para leer req.cookies (state CSRF)

// Exponer cabeceras para el frontend si las necesitas
app.use((req, res, next) => {
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, X-Request-Id");
  next();
});

// 🔒 JSON body limit global
app.use(express.json({ limit: "5mb" }));

// 🔒 Cabeceras globales suaves
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Conexión DB
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

// Deep health (reemplaza el handler antiguo de /api/health)
app.use("/api", healthRoutes);

// Estáticos para archivos subidos (storage check usa esta carpeta)
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Expose-Headers", "Content-Length");
  }
}));

// Socket.io con mismo CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("WS CORS bloqueado: " + origin)),
    methods: ["GET","POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => registerChatSocket(io, socket));

// 🔒 Manejador de errores final
app.use((err, _req, res, _next) => {
  const msg = process.env.NODE_ENV === "development" ? (err?.message || "Error") : "Error interno";
  const code = err.status || 500;
  res.status(code).json({ error: msg });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 API + WS en puerto ${PORT}`);
  console.log(`[CORS] Allowed: ${ALLOWED_ORIGINS.join(", ") || "(default)"}`);
});
