// 1) Cargar variables de entorno ANTES de leer process.env
require('dotenv').config();

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error('MONGODB_URI no está definida');
    }

    // 2) Log de qué URI y qué DB vamos a usar (útil para este debug)
    console.log('[DB] MONGODB_URI =', uri);
    // Si prefieres, puedes imprimir sólo el nombre de la BD parseado:
    // const dbName = new URL(uri).pathname.replace(/^\//, '').split('?')[0];
    // console.log('[DB] Nombre de BD (parseado):', dbName);

    const conn = await mongoose.connect(uri);
    console.log('[DB] Conectado host:', conn.connection.host);
    console.log('[DB] Base de datos:', conn.connection.name);
  } catch (error) {
    console.error('[DB] Error conectando a MongoDB:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
