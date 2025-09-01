// controllers/authController-1.js
// Registro, Login y Refresh con rotación segura y "grace path" para refresh faltante.
// + Logout: limpia la cookie de refresh correctamente.
//
// Ajustes: endurecemos set de cookie en refresh y añadimos no-store en la respuesta.
// También normalizamos los campos { token, expiresIn, issuedAt } para el frontend.

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily, hashToken, getAccessTTLSeconds } = require("../helpers/tokens");

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

// === util: detectar HTTPS real o si corre detrás de proxy
function isHttps(req) {
  if (req && req.secure) return true;
  const xfp = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return xfp === "https";
}

function getRefreshCookieOpts(req) {
  const https = isHttps(req);
  // En HTTPS forzamos secure+none. En HTTP (local/LAN) usamos lax+no-secure.
  const secure = https ? true : false;
  const sameSite = https ? "none" : "lax";

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

function clearRefreshCookieAll(req, res) {
  try { res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOpts(req)); } catch (_) {}
}

function ensureSetRefreshCookie(req, res, token) {
  try {
    setRefreshCookie(req, res, token);
  } catch {
    res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOpts(req));
  }
  try {
    // exponer longitud si pasa por proxy
    res.setHeader("Access-Control-Expose-Headers", "Content-Length");
  } catch {}
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

    try {
      const { requestVerificationEmail } = require("./emailController");
      const fakeReq = { body: { userId: nuevoUsuario._id, correo: nuevoUsuario.correo } };
      const fakeRes = { json: () => {}, status: () => ({ json: () => {} }) };
      requestVerificationEmail(fakeReq, fakeRes);
    } catch (_) {}

    const access = signAccess(nuevoUsuario._id);
    const { refresh } = await signRefresh(nuevoUsuario._id);
    ensureSetRefreshCookie(req, res, refresh);

    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json({
      mensaje: "Registro Exitoso",
      token: access,
      expiresIn: getAccessTTLSeconds(),
      issuedAt: Date.now(),
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
    ensureSetRefreshCookie(req, res, refresh);

    const actualizado = await Usuario.findById(usuario._id).lean();
    if (!actualizado) {
      return res.status(404).json({ mensaje: "Usuario no encontrado después de login" });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ token: access, expiresIn: getAccessTTLSeconds(), issuedAt: Date.now(), usuario: actualizado });
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

    ensureSetRefreshCookie(req, res, newRefresh);

    const expiresIn = getAccessTTLSeconds();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ token, expiresIn, issuedAt: Date.now() });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en refresh:", e);
    }
    return res.status(500).json({ mensaje: "Error en refresh" });
  }
};

/* ===================== LOGOUT (limpia cookie de refresh) ===================== */
const logoutUsuario = async (req, res) => {
  try {
    clearRefreshCookieAll(req, res);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ mensaje: "Logout OK" });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Error en logout:", e);
    }
    return res.status(500).json({ mensaje: "Error en logout" });
  }
};

module.exports = {
  registrarUsuario,
  loginUsuario,
  refreshToken,
  logoutUsuario,
};
