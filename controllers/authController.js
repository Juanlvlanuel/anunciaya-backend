// controllers/authController-1.js
// Copia actual con metadata de sesión al crear/rotar refresh (ua, ip, lastUsedAt)
// ✅ Incluye normalización de 2FA (headers y múltiples alias) + tolerancia de tiempo y logs de depuración

const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const { signAccess, signRefresh, revokeFamily, hashToken, getAccessTTLSeconds } = require("../helpers/tokens");
const speakeasy = require("speakeasy");

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

function clientMeta(req) {
  const ua = String(req.headers["user-agent"] || "");
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || (req.connection && req.connection.remoteAddress) || null;
  return { ua, ip };
}

function isHttps(req) {
  if (req && req.secure) return true;
  const xfp = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return xfp === "https";
}

function getRefreshCookieOpts(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    domain: "localhost", // 🔒 Obligatorio para que funcione solo con http://localhost
  };
}




function clearRefreshCookieAll(req, res) {
  try { res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOpts(req)); } catch (_) { }
}

function ensureSetRefreshCookie(req, res, token) {
  try {
    setRefreshCookie(req, res, token);
  } catch {
    res.cookie(REFRESH_COOKIE_NAME, token, getRefreshCookieOpts(req));
  }
  try {
    res.setHeader("Access-Control-Expose-Headers", "Content-Length");
  } catch { }
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
      const fakeRes = { json: () => { }, status: () => ({ json: () => { } }) };
      requestVerificationEmail(fakeReq, fakeRes);
    } catch (_) { }

    const access = signAccess(nuevoUsuario._id);
    const { refresh, jti } = await signRefresh(nuevoUsuario._id);
    ensureSetRefreshCookie(req, res, refresh);
    try {
      const { ua, ip } = clientMeta(req);
      try {
        const rtPayload = jwt.decode(refresh);
        const incomingHash = require("../helpers/tokens").hashToken(refresh);
        const set = { ua, ip, lastUsedAt: new Date(), tokenHash: incomingHash };
        const setOnInsert = { createdAt: new Date() };
        if (rtPayload && rtPayload.fam) setOnInsert.family = rtPayload.fam;
        if (rtPayload && rtPayload.exp) setOnInsert.expiresAt = new Date(rtPayload.exp * 1000);
        await RefreshToken.updateOne(
          { jti, userId: nuevoUsuario._id },
          { $set: set, $setOnInsert: setOnInsert },
          { upsert: true }
        );
      } catch { }
    } catch { }
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
    let usuario = await Usuario.findOne({ correo }).select("+contraseña +failedLoginCount +lockUntil +twoFactorSecret twoFactorEnabled");

    if (!usuario) {
      usuario = await Usuario.findOne({ nickname: correoRaw }).select("+contraseña +failedLoginCount +lockUntil +twoFactorSecret twoFactorEnabled");
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

    // ✅ Normaliza el código 2FA desde body o headers
    const code = String(
      req.headers["x-2fa-code"] ||
      req.headers["x-two-factor-code"] ||
      req.body?.codigo2FA ||
      req.body?.codigo2fa ||
      req.body?.twoFactorCode ||
      req.body?.twoFactorToken ||
      req.body?.otp ||
      req.body?.totp ||
      req.body?.code ||
      req.body?.["2fa"] ||
      ""
    ).replace(/\s+/g, "");

    if (usuario.twoFactorEnabled) {
      if (!code) {
        return res.status(401).json({ requiere2FA: true, mensaje: "2FA requerido" });
      }

      // 🔎 Logs de depuración (remover en prod)
      try {
        const delta = speakeasy.totp.verifyDelta({
          secret: usuario.twoFactorSecret,
          encoding: "base32",
          token: code,
          window: 2, // ±60s
        });
        if (delta === null) {
          const now = Math.floor(Date.now() / 1000);
          const prev = speakeasy.totp({ secret: usuario.twoFactorSecret, encoding: "base32", time: now - 30 });
          const curr = speakeasy.totp({ secret: usuario.twoFactorSecret, encoding: "base32", time: now });
          const next = speakeasy.totp({ secret: usuario.twoFactorSecret, encoding: "base32", time: now + 30 });
          console.log("[2FA DEBUG] uid:", String(usuario._id), "code:", code, "prev:", prev, "curr:", curr, "next:", next);
        } else {
          console.log("[2FA DEBUG] uid:", String(usuario._id), "code:", code, "delta:", delta.delta);
        }
      } catch (e) {
        console.log("[2FA DEBUG] error:", e?.message || e);
      }

      const verificado = speakeasy.totp.verify({
        secret: usuario.twoFactorSecret, // base32
        encoding: "base32",
        token: code,
        window: 2, // ±60s
      });

      if (!verificado) {
        return res.status(400).json({ requiere2FA: true, mensaje: "Código 2FA inválido o expirado" });
      }
    }

    const access = signAccess(usuario._id);
    const { refresh, jti } = await signRefresh(usuario._id);
    ensureSetRefreshCookie(req, res, refresh);
    try {
      const { ua, ip } = clientMeta(req);
      try {
        const rtPayload = jwt.decode(refresh);
        const incomingHash = require("../helpers/tokens").hashToken(refresh);
        const set = { ua, ip, lastUsedAt: new Date(), tokenHash: incomingHash };
        const setOnInsert = { createdAt: new Date() };
        if (rtPayload && rtPayload.fam) setOnInsert.family = rtPayload.fam;
        if (rtPayload && rtPayload.exp) setOnInsert.expiresAt = new Date(rtPayload.exp * 1000);
        await RefreshToken.updateOne(
          { jti, userId: usuario._id },
          { $set: set, $setOnInsert: setOnInsert },
          { upsert: true }
        );
      } catch { }
    } catch { }
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

/* ===================== REFRESH TOKEN ===================== */
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

    const incomingHash = require("../helpers/tokens").hashToken(raw);
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
      } catch (_) { }
    }

    if (!doc || doc.revokedAt || doc.tokenHash !== incomingHash) {
      try { await revokeFamily(payload.fam); } catch (_) { }
      clearRefreshCookieAll(req, res);
      return res.status(401).json({ mensaje: "Refresh reutilizado o inválido" });
    }

    // Revocar el usado y rotar
    doc.revokedAt = new Date();
    await doc.save();

    const token = signAccess(payload.uid);
    const { refresh: newRefresh, jti: newJti } = await signRefresh(payload.uid, payload.fam);
    ensureSetRefreshCookie(req, res, newRefresh);
    try {
      const { ua, ip } = clientMeta(req);
      try {
        const newIncomingHash = require("../helpers/tokens").hashToken(newRefresh);
        await RefreshToken.updateOne(
          { jti: newJti, userId: payload.uid },
          { $set: { ua, ip, lastUsedAt: new Date(), tokenHash: newIncomingHash }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
      } catch { }
    } catch { }
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

/* ===================== LOGOUT ===================== */
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
