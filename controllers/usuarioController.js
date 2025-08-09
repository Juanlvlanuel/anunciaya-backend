// controllers/usuarioController.js
const Usuario = require("../models/Usuario");
const generarJWT = require("../helpers/generarJWT");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");
const { Types } = require("mongoose");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// REGISTRO TRADICIONAL
const registrarUsuario = async (req, res) => {
  try {
    const { correo, contraseña, nombre, tipo, perfil } = req.body;

    if (!correo || !contraseña || !tipo || !perfil) {
      return res.status(400).json({ mensaje: "Faltan campos Obligatorios" });
    }

    const existeCorreo = await Usuario.findOne({ correo });
    if (existeCorreo) {
      if (existeCorreo.tipo === tipo) {
        return res.status(400).json({
          mensaje: `Ya tienes una Cuenta Registrada como ${tipo === "usuario" ? "Usuario" : "Comerciante"}. Inicia sesión en lugar de Registrarte.`,
          tipoCoincide: true,
        });
      } else {
        return res.status(400).json({
          mensaje: `Este Correo ya está Registrado como ${existeCorreo.tipo === "usuario" ? "Usuario" : "Comerciante"}. No puedes Registrar otro tipo de Cuenta con el mismo Correo.`,
          tipoCoincide: false,
        });
      }
    }

    const nuevoUsuario = new Usuario({
      correo,
      contraseña,
      nombre: nombre || "",
      tipo,
      perfil,
      nickname: correo.split("@")[0] + Date.now(),
    });

    await nuevoUsuario.save();
    const token = await generarJWT(nuevoUsuario._id);

    res.status(200).json({
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
    console.error("❌ Error al Registrar:", error.message);
    res.status(500).json({ mensaje: "Error al registrar Usuario" });
  }
};


// LOGIN TRADICIONAL — POR CORREO O NICKNAME
const loginUsuario = async (req, res) => {
  try {
    const { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
      return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
    }

    const usuario = await Usuario.findOne({
      $or: [
        { correo: correo.trim().toLowerCase() },
        { nickname: correo.trim() }
      ]
    });

    if (!usuario) {
      return res.status(400).json({ mensaje: "El correo electrónico o nickname no existe." });
    }

    const esPasswordCorrecta = await usuario.comprobarPassword(contraseña);
    if (!esPasswordCorrecta) {
      return res.status(400).json({ mensaje: "La contraseña es incorrecta." });
    }

    const token = await generarJWT(usuario._id);

    res.status(200).json({
      mensaje: "Login exitoso",
      token,
      usuario: {
        _id: usuario._id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        tipo: usuario.tipo,
        perfil: usuario.perfil,
        nickname: usuario.nickname
      },
    });
  } catch (error) {
    console.error("❌ Error en login:", error.message);
    res.status(500).json({ mensaje: "Error al iniciar sesión" });
  }
};


// SELECCIONAR PERFIL
const seleccionarPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?._id;
    const { perfil } = req.body;

    if (!perfil) {
      return res.status(400).json({ mensaje: "Perfil no especificado" });
    }

    const usuario = await Usuario.findById(usuarioId);
    if (!usuario) {
      return res.status(404).json({ mensaje: "Usuario no Encontrado" });
    }

    usuario.perfil = perfil;
    await usuario.save();

    res.status(200).json({ mensaje: "Perfil Actualizado", perfil: usuario.perfil });
  } catch (error) {
    console.error("❌ Error al actualizar Perfil:", error.message);
    res.status(500).json({ mensaje: "Error al actualizar Perfil" });
  }
};

// AUTENTICACIÓN CON GOOGLE — BLINDADA
const autenticarConGoogle = async (req, res) => {
  try {
    const { credential, tipo, perfil } = req.body;
    if (!credential) {
      return res.status(400).json({ mensaje: "Token de Google no Recibido" });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const correo = payload.email;
    const nombre = payload.name;

    let usuario = await Usuario.findOne({ correo });

    if (usuario) {
      if (tipo) {
        if (usuario.tipo === tipo) {
          return res.status(400).json({
            mensaje: `Ya tienes una cuenta Registrada como ${tipo === "usuario" ? "Usuario" : "Comerciante"}. Inicia sesión en lugar de Registrarte.`,
            tipoCoincide: true,
          });
        } else {
          return res.status(400).json({
            mensaje: `Este correo ya está Registrado como ${usuario.tipo === "usuario" ? "Usuario" : "Comerciante"}. No puedes Registrar otro tipo de cuenta con el mismo Correo.`,
            tipoCoincide: false,
          });
        }
      }
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
      perfil,
      contraseña: "",
      nickname: correo.split("@")[0] + Date.now(),
      autenticadoPorGoogle: true,
    });
    await usuario.save();

    const token = await generarJWT(usuario._id);

    res.status(200).json({
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
    console.error("❌ Error en Google Auth:", error.message);
    res.status(500).json({ mensaje: "Error con autenticación Google" });
  }
};


// HANDLER PARA GOOGLE OAUTH CALLBACK (GET)
const googleCallbackHandler = async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Código de Google no recibido");

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://anunciaya-backend-production.up.railway.app/auth/google/callback"
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const { email, name } = userInfo.data;

    let usuario = await Usuario.findOne({ correo: email });

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
    console.error("❌ Error en Google Callback:", error.message);
    return res.status(500).send("Error en autenticación con Google");
  }
};


/* === BÚSQUEDA GLOBAL OPTIMIZADA === */
const searchUsuarios = async (req, res) => {
  try {
    const raw = req.query.q || "";
    const q = raw.trim();
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const exclude = (req.query.exclude || "").trim();

    if (!q) return res.json([]);

    // Expresión regular para búsqueda parcial e insensible a mayúsculas
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped.split(/\s+/).join(".*"), "i");

    const filter = {
      $and: [
        { $or: [{ nickname: regex }, { correo: regex }] },
        ...(exclude && Types.ObjectId.isValid(exclude)
          ? [{ _id: { $ne: new Types.ObjectId(exclude) } }]
          : []),
      ],
    };

    const users = await Usuario.find(filter)
      .select("_id nombre nickname correo fotoPerfil tipo")
      .limit(limit)
      .lean();

    res.json(users);
  } catch (e) {
    console.error("❌ searchUsuarios:", e.message);
    res.status(500).json({ mensaje: "Error en búsqueda" });
  }
};


module.exports = {
  registrarUsuario,
  loginUsuario,
  seleccionarPerfil,
  autenticarConGoogle,
  googleCallbackHandler,
  searchUsuarios,
};
