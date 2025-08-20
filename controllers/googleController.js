// controllers/googleController-1.js
// FastUX: añade expiresIn/issuedAt en las respuestas, manteniendo compatibilidad.
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");

const {
  Usuario,
  signAccess,
  signRefresh,
  setRefreshCookie,
  norm,
  normEmail,
  escapeRegExp,
  extractTipoPerfil,
  normalizePerfilToSchema,
} = require("./_usuario.shared");

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

const STATE_COOKIE = process.env.STATE_COOKIE_NAME || "g_state";
const stateCookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/usuarios/auth/google/callback",
  maxAge: 5 * 60 * 1000,
};

function parseExpiresToSeconds(expStr) {
  const s = String(expStr || "15m").trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s,10);
  const m = s.match(/^(\d+)\s*([smhd])$/);
  if (!m) return 900;
  const n = parseInt(m[1],10);
  const unit = m[2];
  const map = { s:1, m:60, h:3600, d:86400 };
  return n * (map[unit] || 60);
}

/* ===================== AUTENTICACIÓN CON GOOGLE (One Tap) ===================== */
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

    const expiresIn = parseExpiresToSeconds(process.env.JWT_EXPIRES_IN || "15m");
    const issuedAt = Date.now();

    if (usuario) {
      const attemptedRegister = Object.prototype.hasOwnProperty.call(req.body || {}, 'tipo') ||
                                Object.prototype.hasOwnProperty.call(req.body || {}, 'perfil');
      if (attemptedRegister) {
        return res.status(409).json({ mensaje: 'Este correo ya tiene una cuenta registrada. Inicia sesión para continuar.' });
      }
      let access;
      try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
      let refresh;
      try { const tmp = await signRefresh(usuario._id); const { refresh: r } = tmp; refresh = r; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
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
        expiresIn,
        issuedAt,
      });
    }

    // Registro con Google (requiere tipo/perfil)
    const hasTipo = Object.prototype.hasOwnProperty.call(req.body || {}, 'tipo');
    const hasPerfil = Object.prototype.hasOwnProperty.call(req.body || {}, 'perfil');
    if (!hasTipo || !hasPerfil) {
      return res.status(400).json({ mensaje: 'No existe ninguna cuenta Registrada con este Correo. Regístrate para Iniciar Sesión.' });
    }
    let { tipo, perfil } = extractTipoPerfil(req.body || {});
    if (!tipo || !perfil) {
      return res.status(400).json({ mensaje: 'No existe ninguna cuenta Registrada con este Correo. Regístrate para Iniciar Sesión.' });
    }
    usuario = new Usuario({
      correo,
      nombre,
      tipo,
      perfil: String(normalizePerfilToSchema(perfil)),
      nickname: (correo.split("@")[0] || "user") + Date.now(),
      autenticadoPorGoogle: true,
    });
    await usuario.save();

    let access;
    try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(usuario._id); const { refresh: r } = tmp; refresh = r; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
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
      expiresIn,
      issuedAt,
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
    const name = require("./_usuario.shared").norm(userInfo?.data?.name);

    if (!email) return res.status(400).send("Google no retornó correo");

    const correoCI = new RegExp(`^${escapeRegExp(email)}$`, "i");
    let usuario = await Usuario.findOne({ correo: correoCI });

    const expiresIn = parseExpiresToSeconds(process.env.JWT_EXPIRES_IN || "15m");
    const issuedAt = Date.now();

    if (!usuario) {
      return res.redirect(
        `https://anunciaya-frontend.vercel.app/?googleNewUser=1&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
      );
    }

    let access;
    try { access = signAccess(usuario._id); } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando token" }); }
    let refresh;
    try { const tmp = await signRefresh(usuario._id); const { refresh: r } = tmp; refresh = r; } catch (e) { return res.status(500).json({ mensaje: e.message || "Error firmando refresh" }); }
    setRefreshCookie(req, res, refresh);

    return res.redirect(
      `https://anunciaya-frontend.vercel.app/?googleToken=${access}&expiresIn=${expiresIn}&issuedAt=${issuedAt}`
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

module.exports = {
  autenticarConGoogle,
  iniciarGoogleOAuth,
  googleCallbackHandler,
};
