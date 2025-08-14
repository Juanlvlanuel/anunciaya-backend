// controllers/usuarioController-1.js
// Ajustes: bloqueo temporal tras 5 intentos fallidos (3 minutos) en login tradicional.
// Mantiene Google Login con 401 ante credential inválido/expirado/malformado.

const Usuario = require("../models/Usuario");
const generarJWT = require("../helpers/generarJWT");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");
const { Types } = require("mongoose");

// Normaliza variables de entorno para Google OAuth
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  process.env.CLIENT_ID_PROD ||
  process.env.CLIENT_ID_MAIN;

const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const REDIRECT_URI =
  "https://anunciaya-backend-production.up.railway.app/api/usuarios/auth/google/callback";

/* ===================== Helpers ===================== */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (v) => (v ?? "").toString().trim();
const normEmail = (v) => norm(v).toLowerCase();
const isValidObjectId = (id) => Types.ObjectId.isValid(String(id || ""));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Colecta y normaliza tipo/perfil */
const extractTipoPerfil = (raw) => {
  let t = norm(raw?.tipo);
  let p = raw?.perfil;

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
          mensaje: `Ya tienes una Cuenta Registrada como ${tipo === "usuario" ? "Usuario" : "Comerciante"}. Inicia sesión en lugar de Registrarte.`,
          tipoCoincide: true,
        });
      } else {
        return res.status(409).json({
          mensaje: `Este Correo ya está Registrado como ${existeCorreo.tipo === "usuario" ? "Usuario" : "Comerciante"}. No puedes Registrar otro tipo de Cuenta con el mismo Correo.`,
          tipoCoincide: false,
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
    const token = await generarJWT(nuevoUsuario._id);

    return res.status(200).json({
      mensaje: "Registro Exitoso",
      token,
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
      return res.status(400).json({ mensaje: `El ${campo} ya está registrado.` });
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
    const correoRaw = (req.body?.correo || req.body?.email || req.body?.login || "").toString().trim();
    const contraseña = (req.body?.contraseña || req.body?.password || "").toString().trim();

    if (!correoRaw || !contraseña) {
      return res.status(400).json({ mensaje: "Faltan credenciales" });
    }

    const correo = correoRaw.toLowerCase();

    // Seleccionamos contraseña + campos de seguridad
    let usuario = await Usuario.findOne({ correo }).select("+contraseña +failedLoginCount +lockUntil");

    if (!usuario) {
      usuario = await Usuario.findOne({ nickname: correoRaw }).select("+contraseña +failedLoginCount +lockUntil");
    }
    if (!usuario) {
      return res.status(404).json({ mensaje: "No existe una cuenta con este correo. Regístrate para continuar." });
    }

    // ¿Cuenta bloqueada temporalmente?
    const now = Date.now();
    if (usuario.lockUntil && usuario.lockUntil.getTime() > now) {
      const retryAfterMs = usuario.lockUntil.getTime() - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      res.setHeader("Retry-After", retryAfterSec);
      return res.status(423).json({
        mensaje: "Cuenta temporalmente bloqueada por múltiples intentos fallidos. Debes esperar 3 minutos antes de volver a intentar.",
        retryAfterSeconds: retryAfterSec,
      });
    }

    const esValida = await usuario.comprobarPassword(contraseña);
    if (!esValida) {
      // Incrementar fallos
      const maxIntentos = Usuario.BLOQUEO_MAX_INTENTOS || 5;
      const minutosBloqueo = Usuario.BLOQUEO_MINUTOS || 3;

      const nextFails = (usuario.failedLoginCount || 0) + 1;

      if (nextFails >= maxIntentos) {
        usuario.failedLoginCount = 0; // reset para siguiente ventana
        usuario.lockUntil = new Date(Date.now() + minutosBloqueo * 60 * 1000);
      } else {
        usuario.failedLoginCount = nextFails;
        usuario.lockUntil = null;
      }

      await usuario.save({ validateModifiedOnly: true });

      return res.status(401).json({
        mensaje: "Contraseña incorrecta. Inténtalo de nuevo.",
        remainingAttempts: Math.max(0, (maxIntentos - nextFails)),
        lockedUntil: usuario.lockUntil,
      });
    }

    // Login exitoso: resetear contadores/bloqueos
    if (usuario.failedLoginCount || usuario.lockUntil) {
      usuario.failedLoginCount = 0;
      usuario.lockUntil = null;
      await usuario.save({ validateModifiedOnly: true });
    }

    const token = await generarJWT(usuario._id);
    const usuarioLimpio = usuario.toJSON ? usuario.toJSON() : usuario;
    return res.json({ token, usuario: usuarioLimpio });
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

    return res.status(200).json({ mensaje: "Perfil Actualizado", perfil: usuario.perfil });
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
    let { tipo, perfil } = extractTipoPerfil(req.body || {});

    if (!credential) {
      return res.status(400).json({ mensaje: "Token de Google no Recibido" });
    }
    if (!clientNonce) {
      return res.status(401).json({ mensaje: "NONCE_MISSING" });
    }

    // Validación rápida de formato JWT (3 partes separadas por '.')
    const parts = credential.split(".");
    if (parts.length !== 3 || parts.some(p => !p)) {
      return res.status(401).json({ mensaje: "CREDENTIAL_MALFORMED" });
    }

    // Verificación del ID token de Google
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
    if (!tokenNonce) {
      return res.status(401).json({ mensaje: "NONCE_MISSING" });
    }
    if (tokenNonce !== clientNonce) {
      return res.status(401).json({ mensaje: "NONCE_MISMATCH" });
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
      const token = await generarJWT(usuario._id);
      return res.status(200).json({
        token,
        usuario: {
          _id: usuario._id,
          nombre: usuario.nombre,
          correo: usuario.correo,
          tipo: usuario.tipo,
          perfil: usuario.perfil,
        },
      });
    }

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

    const token = await generarJWT(usuario._id);

    return res.status(200).json({
      mensaje: "Registro y Login con Google Exitoso",
      token,
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
      return res.status(400).json({ mensaje: "El correo ya está registrado." });
    }
    return res.status(500).json({ mensaje: error?.message || "Error con autenticación Google" });
  }
};

// Configuración para cookie del state
const STATE_COOKIE = "g_state";
const stateCookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/usuarios/auth/google/callback", // ⬅️ usar la ruta real del callback
  maxAge: 5 * 60 * 1000, // 5 minutos
};

/* ===================== INICIAR OAUTH (STATE EN COOKIE) ===================== */
const iniciarGoogleOAuth = (req, res) => {
  try {
    const bytes = require("crypto").randomBytes(16);
    const state = bytes.toString("hex");

    // Guardar en cookie httpOnly
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
    if (process.env.NODE_ENV !== "production") console.error("iniciarGoogleOAuth:", e);
    return res.status(500).send("Error iniciando OAuth con Google");
  }
};


/* ===================== HANDLER CALLBACK (GET) ===================== */
const googleCallbackHandler = async (req, res) => {
  try {
    // 1) Validar state
    const stateQuery = (req.query?.state || "").toString().trim();
    const stateCookie = (req.cookies?.[STATE_COOKIE] || "").toString().trim();
    if (!stateQuery || !stateCookie || stateQuery !== stateCookie) {
      res.clearCookie(STATE_COOKIE, { ...stateCookieOpts, maxAge: 0 });
      return res.status(401).send("STATE_INVALID");
    }
    res.clearCookie(STATE_COOKIE, { ...stateCookieOpts, maxAge: 0 });

    // 2) Resto del flujo actual...
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

    const token = await generarJWT(usuario._id);

    return res.redirect(
      `https://anunciaya-frontend.vercel.app/?googleToken=${token}`
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en Google Callback:", error?.message || error);
    }
    return res.status(500).send("Error en autenticación con Google");
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
  iniciarGoogleOAuth, // ⬅️ nuevo
  searchUsuarios,
};
