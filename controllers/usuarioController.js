// controllers/usuarioController-1.js
// Ajustes: respuestas 409 unificadas con `mensaje` claro (duplicado).
// Mantiene 201 en registro exitoso y toda la lógica existente.

const Usuario = require("../models/Usuario");
const generarJWT = require("../helpers/generarJWT");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");
const { Types } = require("mongoose");

// === Refresh token cookie (consistente con usuarioController) ===
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";

// === NUEVO: helpers access/refresh (añadidos sin borrar lógica actual) ===
const { signAccess, signRefresh } = require("../helpers/tokens");

// Detecta si debe usar cookies seguras (https) y SameSite=None
// En localhost/127.0.0.1 SIEMPRE usamos secure:false + sameSite:"lax"
const isLocalhost = (req) => {
  const host = String(req.headers?.host || "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1";
};

const isHttps = (req) => {
  return !!(req?.secure || String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase() === "https");
};

const setRefreshCookie = (req, res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
  });
};

// === Google OAuth env ===
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  process.env.GOOGLE_CLIENT_ID_PROD || "";

const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ||
  process.env.GOOGLE_CLIENT_SECRET_PROD || "";

const REDIRECT_URI =
  process.env.GOOGLE_CALLBACK_URL ||
  process.env.GOOGLE_CALLBACK_URL_PROD ||
  "https://anunciaya-backend-production.up.railway.app/api/usuarios/auth/google/callback";

const GOOGLE_AUDIENCES = [CLIENT_ID].filter(Boolean);
const client = new OAuth2Client(CLIENT_ID);

/* ===================== Helpers ===================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (v) => (v ?? "").toString().trim();
const normEmail = (v) => norm(v).toLowerCase();
const isValidObjectId = (id) => Types.ObjectId.isValid(String(id || ""));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractTipoPerfil = (raw) => {
  let t = norm(raw?.tipo);
  let p = norm(raw?.perfil);

  if (p && typeof p === "object" && "perfil" in p) p = p.perfil;

  if (typeof p === "string" && (p.trim().startsWith("{") || p.trim().startsWith("["))) {
    try { const parsed = JSON.parse(p); p = parsed?.perfil ?? parsed; } catch { }
  }

  if (typeof p === "string") p = p.trim();
  if (typeof p === "string" && /^\d+$/.test(p)) p = Number(p);

  if (p == null || p === "") p = 1;
  if (!t) t = "usuario";

  return { tipo: t, perfil: p };
};

const normalizePerfilToSchema = (valor) => {
  if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
  return valor;
};

/* ===================== REGISTRO TRADICIONAL ===================== */
const registrarUsuario = async (req, res) => {
  try {
    // Validación mínima de tipos (no rompe flujos existentes)
    if (req.body && 'correo' in req.body && typeof req.body.correo !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'correo'" });
    }
    if (req.body && 'email' in req.body && typeof req.body.email !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'email'" });
    }
    if (req.body && 'contraseña' in req.body && typeof req.body.contraseña !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'contraseña'" });
    }
    if (req.body && 'password' in req.body && typeof req.body.password !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'password'" });
    }

    const rawCorreo = req.body?.correo ?? req.body?.email;
    const rawPass = req.body?.contraseña ?? req.body?.password;
    const rawNombre = req.body?.nombre ?? req.body?.nombreCompleto ?? req.body?.name;

    let correo = normEmail(rawCorreo);
    const pass = norm(rawPass);
    let nombre = norm(rawNombre);

    let { tipo, perfil } = extractTipoPerfil(req.body || {});

    if (!correo || !pass || !tipo || !perfil) {
      return res.status(400).json({ mensaje: "Faltan campos Obligatorios" });
    }
    if (!EMAIL_RE.test(correo)) {
      return res.status(400).json({ mensaje: "Correo inválido" });
    }
    if (pass.length < 6 || pass.length > 128) {
      return res.status(400).json({ mensaje: "La contraseña debe tener entre 6 y 128 caracteres" });
    }

    const correoCI = new RegExp(`^${escapeRegExp(correo)}$`, "i");
    const existeCorreo = await Usuario.findOne({ correo: correoCI });
    if (existeCorreo) {
      if (existeCorreo.tipo === tipo) {
        return res.status(409).json({
          mensaje:
            `Este correo ya tiene una cuenta registrada como ${tipo === "usuario" ? "Usuario" : "Comerciante"}. ` +
            `Si es tuyo, inicia sesión.`,
          error: { code: "DUPLICATE", tipoCoincide: true }
        });
      } else {
        return res.status(409).json({
          mensaje:
            `Este correo ya está registrado como ${existeCorreo.tipo === "usuario" ? "Usuario" : "Comerciante"}. ` +
            `No puedes registrar otro tipo de cuenta con el mismo correo.`,
          error: { code: "DUPLICATE", tipoCoincide: false }
        });
      }
    }

    const nuevoUsuario = new Usuario({
      correo,
      contraseña: pass,
      nombre: nombre || "",
      tipo,
      perfil: String(normalizePerfilToSchema(perfil)),
      nickname: (correo.split("@")[0] || "user") + Date.now(),
    });

    await nuevoUsuario.save();

    let access;
    try { access = signAccess(nuevoUsuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(nuevoUsuario._id); refresh = tmp.refresh; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
    setRefreshCookie(req, res, refresh);

    return res.status(201).json({
      mensaje: "Registro Exitoso",
      token: access,
      usuario: {
        _id: nuevoUsuario._id,
        nombre: nuevoUsuario.nombre,
        correo: nuevoUsuario.correo,
        tipo: nuevoUsuario.tipo,
        perfil: nuevoUsuario.perfil,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error al Registrar:", error);
    }
    if (error?.code === 11000) {
      const campo = Object.keys(error.keyValue || {})[0] || "correo";
      return res.status(409).json({ mensaje: `El ${campo} ya está registrado.` });
    }
    if (error?.name === "ValidationError") {
      const mensajes = Object.values(error.errors || {}).map(e => e.message).filter(Boolean);
      return res.status(400).json({ mensaje: mensajes[0] || "Datos inválidos" });
    }
    return res.status(500).json({ mensaje: error?.message || "Error al registrar Usuario" });
  }
};

/* ===================== LOGIN TRADICIONAL ===================== */
const loginUsuario = async (req, res) => {
  try {
    // Validación mínima de tipos
    if (req.body && 'correo' in req.body && typeof req.body.correo !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'correo'" });
    }
    if (req.body && 'email' in req.body && typeof req.body.email !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'email'" });
    }
    if (req.body && 'login' in req.body && typeof req.body.login !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'login'" });
    }
    if (req.body && 'contraseña' in req.body && typeof req.body.contraseña !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'contraseña'" });
    }
    if (req.body && 'password' in req.body && typeof req.body.password !== 'string') {
      return res.status(400).json({ mensaje: "Tipo inválido en 'password'" });
    }

    const correoRaw = (req.body?.correo || req.body?.email || req.body?.login || "").toString().trim();
    const contraseña = (req.body?.contraseña || req.body?.password || "").toString().trim();

    if (!correoRaw || !contraseña) {
      return res.status(400).json({ mensaje: "Faltan credenciales" });
    }

    const correo = correoRaw.toLowerCase();
    let usuario = await Usuario.findOne({ correo }).select("+contraseña +failedLoginCount +lockUntil");

    if (!usuario) {
      usuario = await Usuario.findOne({ nickname: correoRaw }).select("+contraseña +failedLoginCount +lockUntil");
    }
    if (!usuario) {
      return res.status(404).json({ mensaje: "No existe una cuenta con este correo. Regístrate para continuar." });
    }

    const esValida = await usuario.comprobarPassword(contraseña);
    if (!esValida) {
      const maxIntentos = Usuario.BLOQUEO_MAX_INTENTOS || 5;
      const minutosBloqueo = Usuario.BLOQUEO_MINUTOS || 3;

      const nextFails = (usuario.failedLoginCount || 0) + 1;

      if (nextFails >= maxIntentos) {
        usuario.failedLoginCount = 0;
        usuario.lockUntil = new Date(Date.now() + minutosBloqueo * 60 * 1000);
      } else {
        usuario.failedLoginCount = nextFails;
        usuario.lockUntil = null;
      }

      await usuario.save({ validateModifiedOnly: true });

      return res.status(401).json({
        mensaje: "Contraseña incorrecta.",
        remainingAttempts: Math.max(0, (maxIntentos - nextFails)),
        lockedUntil: usuario.lockUntil,
      });
    }

    if (usuario.failedLoginCount || usuario.lockUntil) {
      usuario.failedLoginCount = 0;
      usuario.lockUntil = null;
      await usuario.save({ validateModifiedOnly: true });
    }

    let access;
    try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(usuario._id); refresh = tmp.refresh; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
    setRefreshCookie(req, res, refresh);

    const usuarioLimpio = usuario.toJSON ? usuario.toJSON() : usuario;
    return res.json({ token: access, usuario: usuarioLimpio });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en login:", error);
    }
    return res.status(500).json({ mensaje: "Error al iniciar sesión" });
  }
};


/* ===================== SELECCIONAR PERFIL ===================== */
const seleccionarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id || req.usuarioId;
    const perfil = norm(req.body?.perfil);

    if (!perfil) {
      return res.status(400).json({ mensaje: "Perfil no especificado" });
    }

    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ mensaje: "Usuario no Encontrado" });
    }

    usuario.perfil = perfil;
    await usuario.save();

    return res.status(201).json({ mensaje: "Perfil Actualizado", perfil: usuario.perfil });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error al actualizar Perfil:", error?.message || error);
    }
    return res.status(500).json({ mensaje: "Error al actualizar Perfil" });
  }
};

/* ===================== AUTENTICACIÓN CON GOOGLE ===================== */
const autenticarConGoogle = async (req, res) => {
  try {
    const credential = norm(req.body?.credential);
    const clientNonce = (req.body && req.body.nonce ? String(req.body.nonce).trim() : "");

    if (!credential) {
      return res.status(400).json({ mensaje: "Token de Google no Recibido" });
    }

    const parts = credential.split(".");
    if (parts.length !== 3 || parts.some(p => !p)) {
      return res.status(401).json({ mensaje: "CREDENTIAL_MALFORMED" });
    }

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_AUDIENCES.length ? GOOGLE_AUDIENCES : undefined,
      });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.error("❌ verifyIdToken:", e?.message || e);
      }
      return res.status(401).json({ mensaje: "CREDENTIAL_INVALID_OR_EXPIRED" });
    }

    const payload = ticket.getPayload() || {};
    const tokenNonce = (payload && payload.nonce ? String(payload.nonce).trim() : "");

    // NONCE opcional salvo GOOGLE_NONCE_STRICT=1
    const strict = String(process.env.GOOGLE_NONCE_STRICT || "") === "1";
    if (strict) {
      if (!clientNonce || !tokenNonce || tokenNonce !== clientNonce) {
        return res.status(401).json({ mensaje: tokenNonce ? "NONCE_MISMATCH" : "NONCE_MISSING" });
      }
    }

    const correo = normEmail(payload.email);
    const nombre = norm(payload.name);
    const emailVerified = !!payload.email_verified;

    if (!correo) {
      return res.status(400).json({ mensaje: "Google no retornó un correo válido" });
    }
    if (!emailVerified) {
      return res.status(400).json({ mensaje: "El correo de Google no está verificado" });
    }

    const correoCI = new RegExp(`^${escapeRegExp(correo)}$`, "i");
    let usuario = await Usuario.findOne({ correo: correoCI });

    if (usuario) {
      let access;
      try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
      let refresh;
      try { const tmp = await signRefresh(usuario._id); refresh = tmp.refresh; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
      setRefreshCookie(req, res, refresh);

      return res.status(200).json({
        token: access,
        usuario: {
          _id: usuario._id,
          nombre: usuario.nombre,
          correo: usuario.correo,
          tipo: usuario.tipo,
          perfil: usuario.perfil,
        },
      });
    }

    // Si no existe, requiere tipo/perfil para registro con Google
    let { tipo, perfil } = extractTipoPerfil(req.body || {});
    if (!tipo || !perfil) {
      return res.status(400).json({
        mensaje: "No existe ninguna cuenta Registrada con este Correo. Regístrate para Iniciar Sesión."
      });
    }

    usuario = new Usuario({
      correo,
      nombre,
      tipo,
      perfil: String(normalizePerfilToSchema(perfil)),
      contraseña: "",
      nickname: (correo.split("@")[0] || "user") + Date.now(),
      autenticadoPorGoogle: true,
    });
    await usuario.save();

    let access;
    try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(usuario._id); refresh = tmp.refresh; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
    setRefreshCookie(req, res, refresh);

    return res.status(200).json({
      mensaje: "Registro y Login con Google Exitoso",
      token: access,
      usuario: {
        _id: usuario._id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        tipo: usuario.tipo,
        perfil: usuario.perfil,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en Google Auth:", error);
    }
    if (error?.code === 11000) {
      return res.status(409).json({ mensaje: "El correo ya está registrado." });
    }
    return res.status(500).json({ mensaje: error?.message || "Error con autenticación Google" });
  }
};

// Configuración para cookie del state
const STATE_COOKIE = process.env.STATE_COOKIE_NAME || "g_state";
const stateCookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/usuarios/auth/google/callback",
  maxAge: 5 * 60 * 1000,
};

/* ===================== INICIAR OAUTH (STATE EN COOKIE) ===================== */
const iniciarGoogleOAuth = (req, res) => {
  try {
    const bytes = require("crypto").randomBytes(16);
    const state = bytes.toString("hex");

    res.cookie(STATE_COOKIE, state, stateCookieOpts);

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["openid", "email", "profile"],
      state,
    });

    return res.redirect(url);
  } catch (e) {
    if (process.env.NODE_ENV !== "production")
      console.error("iniciarGoogleOAuth:", e);
    return res.status(500).send("Error iniciando OAuth con Google");
  }
};

/* ===================== HANDLER CALLBACK (GET) ===================== */
const googleCallbackHandler = async (req, res) => {
  try {
    const stateQuery = (req.query?.state || "").toString().trim();
    const stateCookie = (req.cookies?.[STATE_COOKIE] || "").toString().trim();
    if (!stateQuery || !stateCookie || stateQuery !== stateCookie) {
      res.clearCookie(STATE_COOKIE, { ...stateCookieOpts, maxAge: 0 });
      return res.status(401).send("STATE_INVALID");
    }
    res.clearCookie(STATE_COOKIE, { ...stateCookieOpts, maxAge: 0 });

    const code = norm(req.query?.code);
    if (!code) return res.status(400).send("Código de Google no recibido");

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = normEmail(userInfo?.data?.email);
    const name = norm(userInfo?.data?.name);

    if (!email) return res.status(400).send("Google no retornó correo");

    const correoCI = new RegExp(`^${escapeRegExp(email)}$`, "i");
    let usuario = await Usuario.findOne({ correo: correoCI });

    if (!usuario) {
      return res.redirect(
        `https://anunciaya-frontend.vercel.app/?googleNewUser=1&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
      );
    }

    let access;
    try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(usuario._id); refresh = tmp.refresh; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
    setRefreshCookie(req, res, refresh);

    return res.redirect(
      `https://anunciaya-frontend.vercel.app/?googleToken=${access}`
    );
  } catch (error) {
    console.error("❌ Google Callback error:",
      error?.response?.data || error?.message || error);

    return res
      .status(500)
      .send(
        "Google callback error: " +
        (error?.response?.data?.error_description ||
          error?.response?.data?.error ||
          error?.message ||
          "desconocido")
      );
  }
};

/* ===================== BÚSQUEDA GLOBAL ===================== */
const searchUsuarios = async (req, res) => {
  try {
    const raw = req.query?.q || "";
    const q = norm(raw);
    const limit = Math.min(parseInt(req.query?.limit || "10", 10), 50);
    const exclude = norm(req.query?.exclude);

    if (!q) return res.json([]);

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped.split(/\s+/).join(".*"), "i");

    const filter = {
      $and: [
        { $or: [{ nickname: regex }, { correo: regex }] },
        ...(exclude && isValidObjectId(exclude)
          ? [{ _id: { $ne: new Types.ObjectId(exclude) } }]
          : []),
      ],
    };

    const users = await Usuario.find(filter)
      .select("_id nombre nickname correo fotoPerfil tipo")
      .limit(limit)
      .lean();

    return res.json(users);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ searchUsuarios:", e?.message || e);
    }
    return res.status(500).json({ mensaje: "Error en búsqueda" });
  }
};

module.exports = {
  registrarUsuario,
  loginUsuario,
  seleccionarPerfil,
  autenticarConGoogle,
  googleCallbackHandler,
  iniciarGoogleOAuth,
  searchUsuarios,
};
