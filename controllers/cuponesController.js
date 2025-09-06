// controllers/cuponesController-1.js — v5
const Cupon = require("../models/Cupon");
const CuponCanje = require("../models/CuponCanje");
const cloudinary = require("../utils/cloudinary");
const { emitCuponNew, emitCuponRemoved } = require("../sockets/ioHubCupones");

function toMs(t) {
  const v = new Date(t).getTime();
  return Number.isFinite(v) ? v : null;
}
function minutesLeft(t) {
  const e = toMs(t);
  if (!e) return 0;
  return Math.max(0, Math.ceil((e - Date.now()) / 60000));
}
function uid(req) {
  return String(req?.usuario?._id || req?.usuarioId || req?.user?.id || "");
}

// ===== Helpers de expiración flexible =====
function resolveVenceAt(body = {}) {
  if (body.venceAt) {
    const d = new Date(body.venceAt);
    if (!isNaN(+d)) return d;
  }
  const now = Date.now();
  const ttlMin = Number(body.ttlMin || 0);
  const ttlHoras = Number(body.ttlHoras || 0);
  const ttlDias = Number(body.ttlDias || 0);
  let ttlMs = 0;
  if (ttlMin > 0) ttlMs += ttlMin * 60 * 1000;
  if (ttlHoras > 0) ttlMs += ttlHoras * 60 * 60 * 1000;
  if (ttlDias > 0) ttlMs += ttlDias * 24 * 60 * 60 * 1000;
  if (ttlMs > 0) return new Date(now + ttlMs);
  return null;
}

// GET /api/cupones/expiring
async function listExpiring(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const now = new Date();
    const serverNow = Date.now();

    // Solo válidos y no vencidos
    const defs = await Cupon.find(
      { activa: true, estado: "publicado", venceAt: { $gt: now } },
      // Proyección estricta para no arrastrar campos innecesarios
      {
        _id: 1,
        negocioId: 1,
        titulo: 1,
        etiqueta: 1,
        colorHex: 1,
        venceAt: 1,
        createdAt: 1,
        imageUrl: 1,
        thumbUrl: 1,
        logoUrl: 1,
        logoThumbUrl: 1,
      }
    )
      .sort({ venceAt: 1 })
      .limit(limit)
      .lean();

    const items = (defs || []).map((p) => ({
      id: String(p._id),
      negocioId: String(p.negocioId || ""),
      titulo: p.titulo,
      etiqueta: p.etiqueta || "",
      colorHex: p.colorHex || "#2563eb",
      expiresAt: toMs(p.venceAt),
      publishedAt: toMs(p.createdAt),
      venceEnMin: minutesLeft(p.venceAt),
      imageUrl: p.imageUrl || "",
      thumbUrl: p.thumbUrl || "",
      logoUrl: p.logoThumbUrl || p.logoUrl || "",
    }));

    return res.json({ serverNow, items });
  } catch (e) {
    console.error("cupones.listExpiring", e);
    return res.status(500).json({ mensaje: "Error al listar cupones por vencer" });
  }
}

// POST /api/cupones (solo comerciante)
async function createCupon(req, res) {
  try {
    const userId = uid(req);
    const {
      negocioId,
      titulo,
      etiqueta,
      tipo = "percent",
      valor,
      colorHex,
      stockTotal = 0,
      limitPorUsuario = 1,
      estado = "publicado",
      imageUrl, imagePublicId, thumbUrl, galeria,
      logoUrl, logoPublicId, logoThumbUrl,
    } = req.body || {};

    const venceAt = resolveVenceAt(req.body);

    if (!negocioId || !titulo || !valor) {
      return res.status(400).json({ mensaje: "negocioId, titulo y valor son requeridos" });
    }
    if (!venceAt) {
      return res.status(400).json({ mensaje: "Debes enviar venceAt (ISO) o ttlMin/ttlHoras/ttlDias" });
    }
    const doc = {
      negocioId,
      titulo: String(titulo).trim(),
      etiqueta: etiqueta ? String(etiqueta).trim() : undefined,
      tipo,
      valor: Number(valor),
      venceAt,
      colorHex: colorHex || "#2563eb",
      stockTotal: Number(stockTotal || 0),
      stockUsado: 0,
      limitPorUsuario: Number(limitPorUsuario || 1),
      creadoPor: userId || undefined,
      activa: true,
      estado,
    };

    if (imageUrl) doc.imageUrl = imageUrl;
    if (imagePublicId) doc.imagePublicId = imagePublicId;
    if (thumbUrl) doc.thumbUrl = thumbUrl;
    if (Array.isArray(galeria)) {
      doc.galeria = galeria
        .filter(Boolean)
        .map((g) => ({ url: g?.url || g?.secureUrl || "", publicId: g?.publicId || "", thumbUrl: g?.thumbUrl || "" }))
        .filter((g) => g.url);
    }
    if (logoUrl) doc.logoUrl = logoUrl;
    if (logoPublicId) doc.logoPublicId = logoPublicId;
    if (logoThumbUrl) doc.logoThumbUrl = logoThumbUrl;

    const data = await Cupon.create(doc);

    // Emitir en tiempo real
    try {
      emitCuponNew({
        id: String(data._id),
        titulo: data.titulo,
        etiqueta: data.etiqueta || "",
        colorHex: data.colorHex || "#2563eb",
        expiresAt: new Date(data.venceAt).getTime(),
        publishedAt: new Date(data.createdAt || Date.now()).getTime(),
        serverNow: Date.now(),
      });
    } catch { }

    return res.status(201).json({ ok: true, id: String(data._id) });
  } catch (e) {
    console.error("cupones.create", e);
    return res.status(500).json({ mensaje: "Error al crear el cupón" });
  }
}

// GET /api/cupones/available (auth)
async function listAvailable(req, res) {
  try {
    const userId = uid(req);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const serverNow = Date.now();

    const canjes = await CuponCanje.find({ usuarioId: userId, estado: { $ne: "usado" } })
      .populate({ path: "cuponId" })
      .lean();

    const items = [];
    for (const c of canjes) {
      if (!c.cuponId) continue;
      const p = c.cuponId;
      const expiresAt = toMs(p.venceAt);
      if (!expiresAt || expiresAt <= serverNow || p.activa !== true) continue;

      items.push({
        id: String(p._id),
        couponId: String(c._id),
        titulo: p.titulo,
        etiqueta: p.etiqueta || "",
        colorHex: p.colorHex || "#2563eb",
        estado: c.estado,
        expiresAt,
        publishedAt: toMs(p.createdAt),
        venceEnMin: minutesLeft(p.venceAt),
        imageUrl: p.imageUrl || "",
        thumbUrl: p.thumbUrl || "",
        logoUrl: p.logoThumbUrl || p.logoUrl || "",
      });
      if (items.length >= limit) break;
    }

    return res.json({ serverNow, items });
  } catch (e) {
    console.error("cupones.listAvailable", e);
    return res.status(500).json({ mensaje: "Error al listar cupones disponibles" });
  }
}

// POST /api/cupones/:id/redeem (auth)
async function redeem(req, res) {
  try {
    const userId = uid(req);
    const cuponId = req.params.id;

    const p = await Cupon.findById(cuponId);
    if (!p || p.activa !== true) return res.status(404).json({ mensaje: "Cupón no encontrado" });
    if (minutesLeft(p.venceAt) <= 0) return res.status(400).json({ mensaje: "El cupón ha expirado" });

    const cuentaUsuario = await CuponCanje.countDocuments({ cuponId, usuarioId: userId });
    if (cuentaUsuario >= (p.limitPorUsuario || 1)) {
      return res.status(409).json({ mensaje: "Límite por usuario alcanzado" });
    }

    if ((p.stockTotal || 0) > 0 && (p.stockUsado || 0) >= p.stockTotal) {
      return res.status(409).json({ mensaje: "Sin stock disponible" });
    }

    const codigo = Math.random().toString(36).slice(2, 8).toUpperCase();
    const canje = await CuponCanje.create({
      cuponId,
      usuarioId: userId,
      estado: "asignado",
      codigo,
      canjeadoAt: new Date(),
    });

    if ((p.stockTotal || 0) > 0) {
      await Cupon.updateOne({ _id: cuponId }, { $inc: { stockUsado: 1 } });
    }

    return res.status(201).json({ ok: true, couponId: String(canje._id), codigo });
  } catch (e) {
    console.error("cupones.redeem", e);
    return res.status(500).json({ mensaje: "Error al canjear" });
  }
}

// POST /api/cupones/use (auth)
async function useCoupon(req, res) {
  try {
    const userId = uid(req);
    const { couponId } = req.body || {};
    if (!couponId) return res.status(400).json({ mensaje: "couponId requerido" });

    const canje = await CuponCanje.findById(couponId).populate({ path: "cuponId" });
    if (!canje) return res.status(404).json({ mensaje: "Cupón no encontrado" });

    if (String(canje.usuarioId) !== String(userId)) {
      if (req?.usuario?.tipo !== "comerciante") {
        return res.status(403).json({ mensaje: "No autorizado para usar este cupón" });
      }
    }

    if (canje.estado === "usado") return res.status(409).json({ mensaje: "Cupón ya utilizado" });

    const venceEnMin = minutesLeft(canje.cuponId?.venceAt);
    if (venceEnMin <= 0) return res.status(409).json({ mensaje: "Cupón vencido" });

    canje.estado = "usado";
    canje.usadoAt = new Date();
    await canje.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("cupones.use", e);
    return res.status(500).json({ mensaje: "Error al usar cupón" });
  }
}

// DELETE /api/cupones/:id (auth comerciante)
async function removeCupon(req, res) {
  try {
    const userId = uid(req);
    const id = req.params.id;
    const p = await Cupon.findById(id);
    if (!p) return res.status(404).json({ mensaje: "Cupón no encontrado" });

    const isOwner = String(p.creadoPor || "") === String(userId || "");
    const isMerchant = req?.usuario?.tipo === "comerciante";
    if (!isOwner && !isMerchant) return res.status(403).json({ mensaje: "No autorizado" });

    await Cupon.deleteOne({ _id: id });

    try { emitCuponRemoved({ id: String(id) }); } catch {}

    const ids = [];
    if (p.imagePublicId) ids.push(p.imagePublicId);
    if (Array.isArray(p.galeria)) for (const g of p.galeria) if (g?.publicId) ids.push(g.publicId);
    if (p.logoPublicId) ids.push(p.logoPublicId);
    try { for (const pid of ids) await cloudinary.uploader.destroy(pid, { invalidate: true, resource_type: "image" }); } catch { }

    return res.json({ ok: true });
  } catch (e) {
    console.error("cupones.remove", e);
    return res.status(500).json({ mensaje: "Error al eliminar el cupón" });
  }
}

module.exports = { listExpiring, createCupon, listAvailable, redeem, useCoupon, removeCupon };
