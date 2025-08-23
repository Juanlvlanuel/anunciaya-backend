// controllers/authController-1.js
// Registro, Login y Refresh con rotación segura y "grace path" para refresh faltante.
// - Si el refresh verifica pero no existe registro en DB (primera migración, limpieza, etc.),
//   se crea on-the-fly y se rota sin marcar "reutilizado".

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily, hashToken, getAccessTTLSeconds } = require("../helpers/tokens");

// Reutilizamos helpers y modelo de Usuario desde tu shared
const {
  Usuario,
  setRefreshCookie,
  EMAIL_RE,
  norm,
  normEmail,
  escapeRegExp,
  extractTipoPerfil,
  normalizePerfilToSchema,
} = require("./_usuario.shared");

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "rid";
const isLocalhost = (req) => {
  try {
    const host = String(req.headers?.host || "").split(":")[0];
    return host === "localhost" || host === "127.0.0.1";
  } catch (_) { return true; }
};
function getRefreshCookieOpts(req) {
  const local = isLocalhost(req);
  return {
    httpOnly: true,
    sameSite: local ? "lax" : "none",
    secure: local ? false : true,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}
function clearRefreshCookieAll(req, res) {
  try { res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOpts(req)); } catch (_) {}
}

/* ===================== REGISTRO TRADICIONAL ===================== */
const registrarUsuario = async (req, res) => {
  try {
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

    // Envío de verificación (no bloqueante)
    try {
      const { requestVerificationEmail } = require("./emailController");
      const fakeReq = { body: { userId: nuevoUsuario._id, correo: nuevoUsuario.correo } };
      const fakeRes = { json: () => {}, status: () => ({ json: () => {} }) };
      requestVerificationEmail(fakeReq, fakeRes);
    } catch (_) {}

    const access = signAccess(nuevoUsuario._id);
    const { refresh } = await signRefresh(nuevoUsuario._id);
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

    if (correoRaw.includes("@")) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!EMAIL_RE.test(correoRaw)) {
        return res.status(400).json({ mensaje: "El correo no es válido. Ingresa un formato correcto (ej. usuario@dominio.com)" });
      }
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

    const access = signAccess(usuario._id);
    const { refresh } = await signRefresh(usuario._id);
    setRefreshCookie(req, res, refresh);

    const actualizado = await Usuario.findById(usuario._id).lean();
    if (!actualizado) {
      return res.status(404).json({ mensaje: "Usuario no encontrado después de login" });
    }
    return res.json({ token: access, usuario: actualizado });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en login:", error);
    }
    return res.status(500).json({ mensaje: "Error al iniciar sesión" });
  }
};

/* ===================== REFRESH TOKEN (rotación segura + grace) ===================== */
const refreshToken = async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return res.status(401).json({ mensaje: "No refresh token" });

    let payload;
    try {
      payload = jwt.verify(raw, process.env.REFRESH_JWT_SECRET, {
        issuer: process.env.JWT_ISS,
        audience: process.env.JWT_AUD,
      });
    } catch (_) {
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh inválido" });
    }

    const incomingHash = hashToken(raw);
    let doc = await RefreshToken.findOne({ jti: payload.jti, userId: payload.uid });

    if (!doc) {
      // ⚠️ Grace path: si no existe registro pero el JWT es válido (p.ej. tras limpiar colección),
      // creamos el doc y continuamos; no lo tratamos como reutilización maliciosa.
      try {
        await RefreshToken.create({
          userId: payload.uid,
          jti: payload.jti,
          family: payload.fam,
          tokenHash: incomingHash,
          expiresAt: new Date(payload.exp * 1000),
          revokedAt: null,
        });
        doc = await RefreshToken.findOne({ jti: payload.jti, userId: payload.uid });
      } catch (_) {}
    }

    if (!doc || doc.revokedAt || doc.tokenHash !== incomingHash) {
      try { await revokeFamily(payload.fam); } catch (_) {}
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh reutilizado o inválido" });
    }

    // Revocar el usado y rotar
    doc.revokedAt = new Date();
    await doc.save();

    const token = signAccess(payload.uid);
    const { refresh: newRefresh } = await signRefresh(payload.uid, payload.fam);

    try {
      setRefreshCookie(req, res, newRefresh);
    } catch (_) {
      res.cookie(REFRESH_COOKIE_NAME, newRefresh, getRefreshCookieOpts(req));
    }

    const expiresIn = getAccessTTLSeconds();
    return res.json({ token, expiresIn, issuedAt: Date.now() });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en refresh:", e);
    }
    return res.status(500).json({ mensaje: "Error en refresh" });
  }
};

module.exports = {
  registrarUsuario,
  loginUsuario,
  refreshToken,
};
