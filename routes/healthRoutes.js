// routes/healthRoutes.js
// Health "deep": reporta estado de DB y storage y devuelve 503 si algo falla.
// Las rutas __dev para desconectar/reconectar DB están SIEMPRE habilitadas
// (útiles solo en desarrollo; si no quieres exponerlas en prod, bórralas).

const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const router = express.Router();

router.get("/health", async (_req, res) => {
  const out = {
    ok: false,
    time: new Date().toISOString(),
    db: "down",
    storage: "down",
  };

  // 1) DB
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
      out.db = "up";
    } else {
      out.db = "down";
    }
  } catch {
    out.db = "down";
  }

  // 2) Storage (carpeta local uploads escribible)
  try {
    const uploadDir = path.join(__dirname, "../uploads");
    await fs.promises.mkdir(uploadDir, { recursive: true });
    const probe = path.join(uploadDir, ".probe");
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.unlink(probe).catch(() => {});
    out.storage = "up";
  } catch {
    out.storage = "down";
  }

  out.ok = out.db === "up" && out.storage === "up";
  return res.status(out.ok ? 200 : 503).json(out);
});

// ---------- RUTAS DE PRUEBA (siempre activas) ----------
// Simulan caída/reconexión de DB para verificar que /api/health responda 503/200.

router.post("/__dev/db/disconnect", async (_req, res) => {
  try {
    await mongoose.disconnect();
    return res.json({ ok: true, db: "disconnected" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "error" });
  }
});

router.post("/__dev/db/reconnect", async (_req, res) => {
  try {
    const uri =
      process.env.MONGODB_URI ||
      process.env.MONGODB_CNN ||
      process.env.DB_URI ||
      "";
    if (!uri) throw new Error("No hay cadena de conexión (MONGODB_URI)");
    await mongoose.connect(uri);
    return res.json({ ok: true, db: "connected" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "error" });
  }
});

module.exports = router;
