require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const sanitizeInput = require("./middleware/sanitizeInput");
const { Server: SocketIOServer } = require("socket.io");

// Error middlewares
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const connectDB = require("./config/db");
const usuarioRoutes = require("./routes/usuarioRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
const promocionesRoutes = require("./routes/promocionesRoutes");
const rifasRoutes = require("./routes/rifasRoutes");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");
const chatRoutes = require("./routes/chatRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const healthRoutes = require("./routes/healthRoutes");
const { registerChatSocket } = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);

// 🔒 Seguridad básica
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Helmet
app.use(helmet({
  crossOriginResourcePolicy: false,
  hsts: false,
  referrerPolicy: { policy: "no-referrer" },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: []
    }
  }
}));

if (process.env.NODE_ENV === "production") {
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
}

// CORS
const defaultAllowed = [
  "http://localhost:5173",
  "https://anunciaya-frontend.vercel.app",
];
const extraFromEnv = (process.env.CORS_ORIGIN || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...defaultAllowed, ...extraFromEnv])];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("CORS bloqueado: " + origin)),
  optionsSuccessStatus: 200,
  credentials: true,
}));

// Preflight
app.options(/.*/, (req, res) => {
  const origin = req.get("Origin");
  const reqHeaders = req.get("Access-Control-Request-Headers");
  if (typeof isAllowedOrigin === "function" ? isAllowedOrigin(origin) : true) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", reqHeaders || "Content-Type, Authorization, X-Requested-With, X-Request-Id");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  return res.sendStatus(200);
});

app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, X-Request-Id, X-Sanitized, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After");
  next();
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENC_BODY_LIMIT || "5mb" }));

function hasBannedKey(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(v => hasBannedKey(v));
  if (typeof value === "object") {
    for (const k of Object.keys(value)) {
      const kl = String(k).toLowerCase();
      if (k.startsWith("$") || k.includes(".") || kl === "__proto__" || kl === "prototype" || kl === "constructor") {
        return true;
      }
      if (hasBannedKey(value[k])) return true;
    }
  }
  return false;
}
function antiNoSQL(req, res, next) {
  try {
    if (hasBannedKey(req.body) || hasBannedKey(req.query) || hasBannedKey(req.params)) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Campos no permitidos en el payload" } });
    }
  } catch (_) {}
  return next();
}
app.use(antiNoSQL);
app.use(sanitizeInput());

app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});

const PUBLIC_ALLOWLIST = [
  /^\/api(\/|$)/,
  /^\/uploads(\/|$)/,
  /^\/socket\.io(\/|$)/,
];

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const url = req.originalUrl || req.url || "";
  for (const rx of PUBLIC_ALLOWLIST) {
    if (rx.test(url)) return next();
  }
  return notFoundHandler(req, res, next);
});

// Timeout
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const url = req.originalUrl || req.url || "";
  if (url === "/api/health" || url.startsWith("/api/health")) return next();

  const isUpload = url.startsWith("/api/upload");
  const baseMs   = parseInt(process.env.REQUEST_TIMEOUT_MS || "15000", 10);
  const uploadMs = parseInt(process.env.REQUEST_TIMEOUT_UPLOAD_MS || "120000", 10);
  const ttlMs    = isUpload ? uploadMs : baseMs;

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.setHeader("Connection", "close");
      return res.status(408).json({ error: { code: "REQUEST_TIMEOUT", message: "Request Timeout" } });
    }
    try { req.destroy && req.destroy(); } catch (e) {}
  }, ttlMs);

  const clear = () => clearTimeout(timer);
  res.on("finish", clear);
  res.on("close", clear);
  next();
});

connectDB();

// Rutas principales con limitadores
const RATE = {
  GLOBAL_WINDOW_MS: parseInt(process.env.RATELIMIT_GLOBAL_WINDOW_MS || "300000", 10),
  GLOBAL_MAX:       parseInt(process.env.RATELIMIT_GLOBAL_MAX || "300", 10),
  LOGIN_WINDOW_MS:  parseInt(process.env.RATELIMIT_LOGIN_WINDOW_MS || "900000", 10),
  LOGIN_MAX:        parseInt(process.env.RATELIMIT_LOGIN_MAX || "10", 10),
  REFRESH_WINDOW_MS:parseInt(process.env.RATELIMIT_REFRESH_WINDOW_MS || "60000", 10),
  REFRESH_MAX:      parseInt(process.env.RATELIMIT_REFRESH_MAX || "60", 10),
  UPLOAD_WINDOW_MS: parseInt(process.env.RATELIMIT_UPLOAD_WINDOW_MS || "900000", 10),
  UPLOAD_MAX:       parseInt(process.env.RATELIMIT_UPLOAD_MAX || "30", 10),
};

const __rateStores = { global: new Map(), login: new Map(), refresh: new Map(), upload: new Map() };

function touchCounter(store, key, windowMs) {
  const n = Date.now();
  let rec = store.get(key);
  if (!rec || n > rec.reset) {
    rec = { count: 0, reset: n + windowMs };
    store.set(key, rec);
  }
  rec.count += 1;
  return { count: rec.count, reset: rec.reset, now: n };
}

function appendExposeHeaders(res, names) {
  const prev = res.getHeader("Access-Control-Expose-Headers");
  const prevList = typeof prev === "string" ? prev.split(",").map(s => s.trim()).filter(Boolean) : [];
  const merged = Array.from(new Set([...prevList, ...names]));
  if (merged.length) res.setHeader("Access-Control-Expose-Headers", merged.join(", "));
}

function setRateHeaders(res, limit, remaining, resetMs) {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining < 0 ? 0 : remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
  appendExposeHeaders(res, ["X-RateLimit-Limit","X-RateLimit-Remaining","X-RateLimit-Reset","Retry-After"]);
}

function makeLimiter(store, { windowMs, max, keyFn, skipFn }) {
  return function limiter(req, res, next) {
    try {
      if (req.method === "OPTIONS") return next();
      if (typeof skipFn === "function" && skipFn(req)) return next();
      const key = keyFn(req);
      const { count, reset, now } = touchCounter(store, key, windowMs);
      const remaining = max - count;
      setRateHeaders(res, max, remaining, reset);
      if (count > max) {
        const retryAfter = Math.max(1, Math.ceil((reset - now) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes" } });
      }
      return next();
    } catch (e) {
      return next();
    }
  };
}

app.use(makeLimiter(__rateStores.global, {
  windowMs: RATE.GLOBAL_WINDOW_MS, max: RATE.GLOBAL_MAX,
  keyFn: (req) => `ip:${req.ip}`, skipFn: (req) => req.path === "/api/health",
}));

app.use("/api/usuarios/login", makeLimiter(__rateStores.login, {
  windowMs: RATE.LOGIN_WINDOW_MS, max: RATE.LOGIN_MAX,
  keyFn: (req) => `login:${req.ip}`, skipFn: (req) => !(req.method === "POST"),
}));

app.use("/api/usuarios/auth/refresh", makeLimiter(__rateStores.refresh, {
  windowMs: RATE.REFRESH_WINDOW_MS, max: RATE.REFRESH_MAX,
  keyFn: (req) => `refresh:${req.ip}`, skipFn: (req) => !(req.method === "POST"),
}));

app.use("/api/upload", makeLimiter(__rateStores.upload, {
  windowMs: RATE.UPLOAD_WINDOW_MS, max: RATE.UPLOAD_MAX,
  keyFn: (req) => `upload:${req.ip}`, skipFn: (req) => !(["POST","PUT","PATCH"].includes(req.method)),
}));

// Rutas
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/logos-carousel", logosCarouselRoutes);
app.use("/api/promociones", promocionesRoutes);
app.use("/api/rifas", rifasRoutes);
app.use("/api/contenido/local", contenidoLocalRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api", healthRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  setHeaders: (res) => { res.setHeader("Access-Control-Expose-Headers", "Content-Length"); }
}));

// Socket.io
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("WS CORS bloqueado: " + origin)),
    methods: ["GET","POST"],
    credentials: true,
  },
});
io.on("connection", (socket) => registerChatSocket(io, socket));

// Not found + error handler (final middleware)
app.all(/^\/(api|uploads)(\/|$)/, notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 API + WS en puerto ${PORT}`);
  console.log(`[CORS] Allowed: ${ALLOWED_ORIGINS.join(", ") || "(default)"}`);
});

try {
  if (process.env.HEADERS_TIMEOUT_MS)        server.headersTimeout   = parseInt(process.env.HEADERS_TIMEOUT_MS, 10);
  if (process.env.REQUEST_TIMEOUT_SERVER_MS) server.requestTimeout   = parseInt(process.env.REQUEST_TIMEOUT_SERVER_MS, 10);
  if (process.env.KEEPALIVE_TIMEOUT_MS)      server.keepAliveTimeout = parseInt(process.env.KEEPALIVE_TIMEOUT_MS, 10);
} catch (_) {}