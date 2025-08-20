// controllers/searchController.js
// Búsqueda de usuarios (nickname/correo).

const { Usuario, norm, isValidObjectId } = require("./_usuario.shared");

const searchUsuarios = async (req, res) => {
  try {
    const raw = req.query?.q || "";
    const q = norm(raw);
    const limit = Math.min(parseInt(req.query?.limit || "10", 10), 50);
    const exclude = norm(req.query?.exclude);

    if (!q) return res.json([]);

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped.split(/\s+/).join(".*"), "i");

    const filter = {
      $and: [
        { $or: [{ nickname: regex }, { correo: regex }] },
        ...(exclude && isValidObjectId(exclude)
          ? [{ _id: { $ne: new (require("mongoose").Types.ObjectId)(exclude) } }]
          : []),
      ],
    };

    const users = await Usuario.find(filter)
      .select("_id nombre nickname correo fotoPerfil tipo")
      .limit(limit)
      .lean();

    return res.json(users);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ searchUsuarios:", e?.message || e);
    }
    return res.status(500).json({ mensaje: "Error en búsqueda" });
  }
};

module.exports = { searchUsuarios };
