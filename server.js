require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { touchOnRequest } = require("./middleware/rememberSessionMeta");
const helmet = require("helmet");
const compression = require("compression"); // 🚀 FastUX: compresión
const sanitizeInput = require("./middleware/sanitizeInput");
const { Server: SocketIOServer } = require("socket.io");

// Error middlewares
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const connectDB = require("./config/db");
const usuarioRoutes = require("./routes/usuarioRoutes");
const adminRoutes = require("./routes/adminRoutes");
const logosCarouselRoutes = require("./routes/logosCarouselRoutes");
const rifasRoutes = require("./routes/rifasRoutes");
const contenidoLocalRoutes = require("./routes/contenidoLocalRoutes");
const chatRoutes = require("./routes/chatRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const healthRoutes = require("./routes/healthRoutes");
const geoRoutes = require("./routes/geoRoutes");
const mediaRoutes = require("./routes/mediaRoutes"); // 👈 NUEVO
const negocioRoutes = require("./routes/negocioRoutes");
const { registerChatSocket } = require("./sockets/chatSocket");
const { registerCuponesSocket } = require("./sockets/ioHubCupones");
const cuponesRoutes = require("./routes/cuponesRoutes");


const app = express();
const server = http.createServer(app);

const IS_PROD = process.env.NODE_ENV === "production";

const mediaCleanupRoutes = require("./routes/mediaCleanupRoutes");

// --- Basic health & root routes for platform health checks ---
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", service: "anunciaya-backend", time: new Date().toISOString() });
});
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});
app.get("/readyz", (req, res) => {
  res.status(200).json({ ready: true });
});
// -------------------------------------------------------------

// 🔒 Seguridad básica
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}


// Helmet
// Solo la sección de Helmet CSP modificada - líneas ~50-70 aproximadamente

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
      imgSrc: ["'self'", "data:", "https:", "https://cdn.jsdelivr.net", "https://res.cloudinary.com"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // 👈 Permite inline scripts
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"], // 👈 Para WebSockets
      upgradeInsecureRequests: []
    }
  }
}));

if (process.env.NODE_ENV === "production") {
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
}

// 🚀 Compresión para respuestas JSON/HTML/etc.
app.use(compression());

// CORS
const defaultAllowed = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://192.168.1.71:5173",
  "http://192.168.1.70:5173",     // tu LAN
  "https://localhost:5173",       // por si el WebView fuerza https con puerto
  "https://localhost",            // 👈 FALTA ESTE, sin puerto
  "capacitor://localhost",        // WebView Capacitor
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

// 🔄 Record / update session metadata on every request (ua, ip, lastUsedAt, tokenHash)
app.use(touchOnRequest);

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
  } catch (_) { }
  return next();
}
app.use(antiNoSQL);
app.use(sanitizeInput());

app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Por defecto no-store para rutas dinámicas
  res.setHeader("Cache-Control", "no-store");
  next();
});

const PUBLIC_ALLOWLIST = [
  /^\/$/, /^\/healthz$/, /^\/readyz$/,
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
  const baseMs = parseInt(process.env.REQUEST_TIMEOUT_MS || "15000", 10);
  const uploadMs = parseInt(process.env.REQUEST_TIMEOUT_UPLOAD_MS || "120000", 10);
  const ttlMs = isUpload ? uploadMs : baseMs;

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.setHeader("Connection", "close");
      return res.status(408).json({ error: { code: "REQUEST_TIMEOUT", message: "Request Timeout" } });
    }
    try { req.destroy && req.destroy(); } catch (e) { }
  }, ttlMs);

  const clear = () => clearTimeout(timer);
  res.on("finish", clear);
  res.on("close", clear);
  next();
});

connectDB();

const RATE = {
  GLOBAL_WINDOW_MS: parseInt(process.env.RATELIMIT_GLOBAL_WINDOW_MS || "300000", 10),
  GLOBAL_MAX: parseInt(process.env.RATELIMIT_GLOBAL_MAX || "300", 10),
  LOGIN_WINDOW_MS: parseInt(process.env.RATELIMIT_LOGIN_WINDOW_MS || "900000", 10),
  LOGIN_MAX: parseInt(process.env.RATELIMIT_LOGIN_MAX || "10", 10),
  REFRESH_WINDOW_MS: parseInt(process.env.RATELIMIT_REFRESH_WINDOW_MS || "60000", 10),
  REFRESH_MAX: parseInt(process.env.RATELIMIT_REFRESH_MAX || "60", 10),
  UPLOAD_WINDOW_MS: parseInt(process.env.RATELIMIT_UPLOAD_WINDOW_MS || "900000", 10),
  UPLOAD_MAX: parseInt(process.env.RATELIMIT_UPLOAD_MAX || "30", 10),
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
  appendExposeHeaders(res, ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset, Retry-After"]);
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

if (IS_PROD) app.use(makeLimiter(__rateStores.global, {
  windowMs: RATE.GLOBAL_WINDOW_MS, max: RATE.GLOBAL_MAX,
  keyFn: (req) => `ip:${req.ip}`, skipFn: (req) => req.path === "/api/health",
}));

// Dev: sin límite en login/refresh/upload
if (!IS_PROD) {
  app.use("/api/usuarios/login", (req, res, next) => {
    try { res.setHeader("X-RateLimit-Limit", "unlimited"); res.setHeader("X-RateLimit-Remaining", "unlimited"); } catch { }
    return next();
  });
  app.use("/api/usuarios/auth/refresh", (req, res, next) => next());
  app.use("/api/upload", (req, res, next) => next());
} else app.use("/api/usuarios/login", makeLimiter(__rateStores.login, {
  windowMs: RATE.LOGIN_WINDOW_MS, max: RATE.LOGIN_MAX,
  keyFn: (req) => `login:${req.ip}`, skipFn: (req) => !(req.method === "POST"),
}));

app.use("/api/usuarios/auth/refresh", makeLimiter(__rateStores.refresh, {
  windowMs: RATE.REFRESH_WINDOW_MS, max: RATE.REFRESH_MAX,
  keyFn: (req) => `refresh:${req.ip}`, skipFn: (req) => !(req.method === "POST"),
}));

app.use("/api/upload", makeLimiter(__rateStores.upload, {
  windowMs: RATE.UPLOAD_WINDOW_MS, max: RATE.UPLOAD_MAX,
  keyFn: (req) => `upload:${req.ip}`, skipFn: (req) => !(["POST", "PUT", "PATCH"].includes(req.method)),
}));

// Rutas
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/logos-carousel", logosCarouselRoutes);
app.use("/api/rifas", rifasRoutes);
app.use("/api/contenido/local", contenidoLocalRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/geo", geoRoutes);
app.use("/api/media", mediaRoutes); // 👈 NUEVO
app.use("/api/negocios", negocioRoutes);
app.use("/api/cupones", cuponesRoutes);
app.use("/api", healthRoutes);
app.use("/api/media", mediaCleanupRoutes);



// Estáticos de uploads con caché larga (override del no-store)
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  setHeaders: (res) => {
    res.setHeader("Access-Control-Expose-Headers", "Content-Length");
    // 🚀 Cache larga para assets versionados
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}));

// Socket.io
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("WS CORS bloqueado: " + origin)),
    methods: ["GET", "POST"],
    credentials: true,
  },
});
io.on("connection", (socket) => registerChatSocket(io, socket));
registerCuponesSocket(io);

// server-WS-patch.txt
// Inserta esto en tu server.js después de crear el `io` y antes de `server.listen(...)`.
// Si ya tienes Socket.IO, solo añade los bloques señalados.

/* ====== INICIO PATCH WS FORCE-LOGOUT ====== */
const jwt = require("jsonwebtoken");

function parseCookie(str) {
  const out = {};
  (str || "").split(";").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > -1) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;
}

app.set("io", io);

// Autenticación por cookie `rid` en el handshake, y unión a rooms por usuario y por sesión
io.use((socket, next) => {
  try {
    const headers = socket.handshake.headers || {};
    const cookies = parseCookie(headers.cookie || "");
    const raw = cookies[process.env.REFRESH_COOKIE_NAME || "rid"];

    // 1) Prefer cookie 'rid' (refresh)
    if (raw) {
      const payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
      });
      socket.data = { uid: payload.uid, jti: payload.jti, fam: payload.fam || null };
      // Compat con chatSocket que usa socket.data.usuarioId
      socket.data.usuarioId = socket.data.uid;
      return next();
    }

    // 2) Fallback: Authorization Bearer (access)
    const auth = (socket.handshake.auth && socket.handshake.auth.token) || headers.authorization || "";
    const m = String(auth || "").match(/^Bearer\s+(.+)$/i);
    if (m) {
      try {
        const ap = jwt.verify(m[1], process.env.JWT_SECRET, {
          issuer: process.env.JWT_ISS,
          audience: process.env.JWT_AUD,
        });
        const uid = ap.uid || ap.sub || ap.userId || ap._id;
        if (uid) {
          socket.data = { uid, jti: null, fam: null, usuarioId: uid };
          return next();
        }
      } catch (_) { /* ignore */ }
    }

    return next(new Error("Unauthorized"));
  } catch (e) {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("session:joinAll", () => {
    const { uid, jti, fam } = socket.data || {};
    if (uid) socket.join(`user:${uid}`);
    if (jti) socket.join(`session:${jti}`);
    if (fam) socket.join(`family:${fam}`);
  });

  // 👇 **mínimo cambio**: unirse también a family:<fam> y soportar session:update
  const { uid, jti, fam } = socket.data || {};
  if (uid) socket.join(`user:${uid}`);
  if (jti) socket.join(`session:${jti}`);
  if (fam) socket.join(`family:${fam}`);

  socket.on("session:update", (payload = {}) => {
    try {
      const nextJti = payload && payload.jti;
      const nextFam = payload && payload.fam;
      if (nextJti && nextJti !== socket.data.jti) {
        if (socket.data.jti) socket.leave(`session:${socket.data.jti}`);
        socket.data.jti = nextJti;
        socket.join(`session:${nextJti}`);
      }
      if (nextFam && nextFam !== socket.data.fam) {
        if (socket.data.fam) socket.leave(`family:${socket.data.fam}`);
        socket.data.fam = nextFam;
        socket.join(`family:${nextFam}`);
      }
    } catch {}
  });
});
/* ====== FIN PATCH WS FORCE-LOGOUT ====== */





// Not found + error handler (final middleware)
app.all(/^\/(api|uploads)(\/|$)/, notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`🚀 API + WS en ${HOST}:${PORT}`);
  console.log(`[CORS] Allowed: ${ALLOWED_ORIGINS.join(", ") || "(default)"}`);
});


try {
  if (process.env.HEADERS_TIMEOUT_MS) server.headersTimeout = parseInt(process.env.HEADERS_TIMEOUT_MS, 10);
  if (process.env.REQUEST_TIMEOUT_SERVER_MS) server.requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_SERVER_MS, 10);
  if (process.env.KEEPALIVE_TIMEOUT_MS) server.keepAliveTimeout = parseInt(process.env.KEEPALIVE_TIMEOUT_MS, 10);
} catch (_) { }