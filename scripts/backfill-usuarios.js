/**
 * scripts/backfill-usuarios.js
 * Normaliza usuarios viejos para que `telefono`, `direccion` y `fotoPerfil` existan y sean string.
 *
 * USO (en la carpeta del backend):
 *   node scripts/backfill-usuarios.js
 *
 * Requiere tu entorno `.env` con MONGO_URI (si no usa tu propio config/db.js).
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

async function connect() {
  // Intenta usar tu propio conector si existe
  try {
    const connectDB = require("../config/db");
    if (typeof connectDB === "function") {
      await connectDB();
      return require("mongoose");
    }
  } catch (_) {}

  // Fallback: conecta con MONGO_URI
  const mongoose = require("mongoose");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ No hay MONGO_URI en el .env y no se pudo cargar config/db.js");
    process.exit(1);
  }
  await mongoose.connect(uri, { });
  return mongoose;
}

(async () => {
  try {
    const mongoose = await connect();
    const Usuario = require("../models/Usuario");

    console.log("🔧 Ejecutando backfill sobre colección:", Usuario.collection.collectionName);

    // Update con pipeline (Mongo 4.2+). Si tu clúster fuera muy viejo, ver notas abajo.
    const res = await Usuario.updateMany(
      {},
      [
        {
          $set: {
            telefono: {
              $cond: [
                { $ne: [ { $type: "$telefono" }, "string" ] },
                { $toString: { $ifNull: ["$telefono", ""] } },
                "$telefono"
              ]
            },
            direccion: {
              $cond: [
                { $ne: [ { $type: "$direccion" }, "string" ] },
                { $toString: { $ifNull: ["$direccion", ""] } },
                "$direccion"
              ]
            },
            fotoPerfil: {
              $cond: [
                { $ne: [ { $type: "$fotoPerfil" }, "string" ] },
                { $toString: { $ifNull: ["$fotoPerfil", ""] } },
                "$fotoPerfil"
              ]
            }
          }
        }
      ]
    );

    console.log("✅ Backfill completado:", res);
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error("❌ Error en backfill:", e);
    process.exit(1);
  }
})();

/*
Si tu clúster no acepta update con pipeline, usa este script alternativo:

const res1 = await Usuario.updateMany({ telefono: { $exists: false } }, { $set: { telefono: "" } });
const res2 = await Usuario.updateMany({ direccion: { $exists: false } }, { $set: { direccion: "" } });
const res3 = await Usuario.updateMany({ fotoPerfil: { $exists: false } }, { $set: { fotoPerfil: "" } });

console.log({ res1, res2, res3 });
*/
