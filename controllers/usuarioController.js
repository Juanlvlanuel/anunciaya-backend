const Usuario = require("../models/Usuario");
const generarJWT = require("../helpers/generarJWT");
const { OAuth2Client } = require("google-auth-library");
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

    // Buscar usuario por correo O por nickname
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
    const usuarioId = req.usuarioId;
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
        mensaje: "Exitoso",
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

module.exports = {
  registrarUsuario,
  loginUsuario,
  seleccionarPerfil,
  autenticarConGoogle,
};
