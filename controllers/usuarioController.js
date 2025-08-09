// controllers/usuarioController.js (fragmento relevante)
const Usuario = require("../models/Usuario");
const generarJWT = require("../helpers/generarJWT");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");
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


// LOGIN TRADICIONAL — AHORA POR CORREO O NICKNAME
const loginUsuario = async (req, res) => {
  try {
    const { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
      return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
    }

    // Buscar usuario por correo O por nickname (sin normalizar: respeta mayúsculas y espacios)
    const usuario = await Usuario.findOne({
      $or: [
        { correo: correo.trim().toLowerCase() },
        { nickname: correo.trim() }
      ]
    });

    if (!usuario) {
      return res.status(400).json({ mensaje: "El correo electrónico o nickname no existe." });
    }

    // Valida contraseña
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
    const usuarioId = req.usuario?._id; // ✅ se toma del middleware verificarToken
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

    res.status(200).json({ mensaje: "Perfil Atualizado", perfil: usuario.perfil });
  } catch (error) {
    console.error("❌ Error al actualizar Perfil:", error.message);
    res.status(500).json({ mensaje: "Error al actualizar Perfil" });
  }
};

// AUTENTICACIÓN CON GOOGLE — FINAL 100% CORREGIDA Y BLINDADA
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
      // Si VIENE tipo en el body = INTENTO DE REGISTRO (debe bloquear)
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
      // Si NO viene tipo = INTENTO DE LOGIN (permite login Google)
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

    // Si NO existe, SOLO permite registro si viene tipo y perfil
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

    // Prepara el OAuth2Client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://anunciaya-backend-production.up.railway.app/auth/google/callback"
    );

    // Intercambia el code por tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obtén la información del usuario
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const { email, name } = userInfo.data;

    let usuario = await Usuario.findOne({ correo: email });

    if (!usuario) {
      // Si el usuario no existe, puedes redirigir a un registro especial
      return res.redirect(
        `https://anunciaya-frontend.vercel.app/?googleNewUser=1&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
      );
    }

    // Si existe, genera token y redirige con el token
    const token = await generarJWT(usuario._id);

    // Puedes redirigir al frontend con el token como query param
    return res.redirect(
      `https://anunciaya-frontend.vercel.app/?googleToken=${token}`
    );

  } catch (error) {
    console.error("❌ Error en Google Callback:", error.message);
    return res.status(500).send("Error en autenticación con Google");
  }
};

/* === NUEVO: BÚSQUEDA DE USUARIOS POR NICKNAME O CORREO (case-sensitive, permite espacios) === */
const searchUsuarios = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const exclude = (req.query.exclude || "").trim(); // opcional: excluir al actual

    if (!q) return res.json([]);

    // escapamos regex para tratar q como literal y buscar "contiene"
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped); // sin bandera 'i' => sensible a mayúsculas

    const or = [{ nickname: { $regex: regex } }, { correo: { $regex: regex } }];

    const filter = exclude ? { $and: [{ _id: { $ne: exclude } }, { $or: or }] } : { $or: or };

    const users = await Usuario.find(filter)
      .select("_id nombre nickname correo fotoPerfil tipo")
      .limit(limit);

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
