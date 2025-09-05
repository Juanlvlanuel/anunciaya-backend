
// controllers/negocioController-1.js
const Negocio = require("../models/Negocio");
const Usuario = require("../models/Usuario");
const { buildThumbFromSecureUrl } = require("./mediaController");

/** ========= Helpers de categorías ========= */
const NEW_SLUGS = new Set([
  "alimentos-consumo",
  "salud-cuidado-personal",
  "servicios-profesionales-generales",
  "boutiques-tiendas",
  "entretenimiento",
  "transporte-movilidad",
  "servicios-financieros",
  "educacion-cuidado",
  "mascotas",
]);

// Aliases de slugs/nombres antiguos -> slugs nuevos
const ALIASES = {
  "alimentos-y-consumo": "alimentos-consumo",
  "salud-y-cuidado-personal": "salud-cuidado-personal",
  "servicios": "servicios-profesionales-generales",
  "servicios-locales": "servicios-profesionales-generales",
  "boutiques-y-tiendas": "boutiques-tiendas",
  "transporte": "transporte-movilidad",
  "educacion-y-cuidado": "educacion-cuidado",

  "comida": "alimentos-consumo",
  "Comida": "alimentos-consumo",
  "salud-fit": "salud-cuidado-personal",
  "Salud & Fit": "salud-cuidado-personal",
  "Servicios": "servicios-profesionales-generales",
  "comercios": "boutiques-tiendas",
  "Comercios": "boutiques-tiendas",
  "diversion": "entretenimiento",
  "Diversión": "entretenimiento",
  "Diversion": "entretenimiento",
  "movilidad": "transporte-movilidad",
  "Movilidad": "transporte-movilidad",
  "finanzas": "servicios-financieros",
  "Finanzas": "servicios-financieros",
  "educacion-cuidado": "educacion-cuidado",
  "Educación y Cuidado": "educacion-cuidado",
  "Educacion y Cuidado": "educacion-cuidado",
  "mascotas": "mascotas",
  "Mascotas": "mascotas",};

const toSlug = (s = "") =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const canonicalCategoria = (input = "") => {
  if (!input) return "";
  const raw = String(input).trim();
  // si ya es nuevo slug
  if (NEW_SLUGS.has(raw)) return raw;
  const slug = toSlug(raw);
  if (NEW_SLUGS.has(slug)) return slug;
  if (ALIASES[raw]) return ALIASES[raw];
  if (ALIASES[slug]) return ALIASES[slug];
  return ""; // desconocido
};

const canonicalSubcat = (input = "") => {
  const slug = toSlug(input);
  return slug;
};
// === Índice de subcategorías por grupo (sincronizado con FE) ===
const SUBCAT_INDEX = new Map([
  ["alimentos-consumo", new Set(["antojitos-y-postres-locales", "cafeterias", "carnicerias", "comida-rapida", "dulcerias", "jugos-y-licuados", "neverias", "panaderias", "pescaderias", "pollerias", "productos-regionales-y-artesanales", "reposterias-y-pastelerias", "restaurantes", "supermercados-y-abarrotes", "tiendas-naturistas", "tortillerias", "vinos-y-licores"])],
  ["salud-cuidado-personal", new Set(["bienestar-y-fitness", "dentistas-y-odontologia", "esteticas-y-barberias", "farmacias", "fisioterapia-y-rehabilitacion", "hospitales-y-centros-de-salud", "laboratorios-clinicos", "medicina-estetica", "medicos-y-clinicas-generales", "nutricion-y-dietetica", "opticas", "psicologia-y-terapias-alternativas", "quiropracticos", "spas-y-masajes"])],
  ["servicios-profesionales-generales", new Set(["agencias-y-servicios-varios", "cuidado-personal-y-social", "eventos-y-producciones", "hogar-y-mantenimiento", "profesionales-y-consultorias", "reparacion-y-soporte", "seguridad-y-funerarias"])],
  ["boutiques-tiendas", new Set(["boutiques-y-ropa", "celulares-y-accesorios", "deportes", "electronica-y-tecnologia", "florerias", "joyerias-y-relojerias", "jugueterias", "librerias", "mueblerias-y-decoracion", "perfumerias-y-cosmeticos", "regalos-y-souvenirs", "zapaterias"])],
  ["entretenimiento", new Set(["actividades-recreativas", "balnearios-y-albercas-recreativas", "bares-y-antros", "centros-de-juegos-infantiles", "karaoke-y-salones-recreativos", "parques-tematicos-y-ferias"])],
  ["transporte-movilidad", new Set(["escuelas-de-manejo", "fletes-y-transporte-de-carga", "gruas-y-auxilio-vial", "renta-de-vehiculos", "repartidores", "seguros-para-autos", "servicios-para-autos", "taxis", "transporte-turistico-y-recreativo"])],
  ["servicios-financieros", new Set(["asesores-financieros-y-contables", "casas-de-empeno", "prestamos-y-creditos", "seguros"])],
  ["educacion-cuidado", new Set(["clases-particulares", "cursos-y-talleres", "escuela-de-idiomas", "escuelas-para-adultos-y-jovenes", "guarderias"])],
  ["mascotas", new Set(["adiestradores-y-entrenadores", "alimentos-especializados", "estetica-y-grooming", "guarderias-y-pensiones", "otros-servicios", "paseadores-de-perros", "tiendas-y-accesorios", "veterinarias-y-clinicas"])]
]);


/**
/** Límite de fotos por plan — Card vs Detalle */
function maxFotosCardByPerfil(perfil) {
  const limits = { 1: 4, 2: 8, 3: 15 };
  return limits[Number(perfil) || 1] || 4;
}
function maxFotosDetailByPerfil(perfil) {
  const limits = { 1: 10, 2: 15, 3: 30 };
  return limits[Number(perfil) || 1] || 10;
}


/* =================== NUEVO: Listado público =================== */
exports.listarNegociosPublicos = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();
    const categoriaIn = (req.query.categoria || req.query.grupo || "").trim();
    const subcatIn = (req.query.subcategoria || req.query.subcat || "").trim();
    const ciudad = (req.query.ciudad || "").trim();

    const filter = { activo: true };

    const catCanonical = canonicalCategoria(categoriaIn);
    if (catCanonical) filter.categoriaSlug = catCanonical;

    const subcatSlug = canonicalSubcat(subcatIn);
    if (subcatIn) filter.subcategoriaSlug = subcatSlug;

    if (ciudad) filter.ciudad = ciudad;
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ nombre: re }, { descripcion: re }];
    }

    const [items, total] = await Promise.all([
      Negocio.find(filter)
        .populate("usuarioId", "perfil") // perfil del comerciante dueño
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Negocio.countDocuments(filter),
    ]);


    const mapped = (items || []).map((n) => {
      const perfilOwner = Number(n?.usuarioId?.perfil) || 1;
      const maxCard = maxFotosCardByPerfil(perfilOwner);

      const allFotos = Array.isArray(n.fotos) ? n.fotos : [];
      const fotosCard = allFotos.slice(0, maxCard);

      const gallery = fotosCard.map((url) => ({
        url,
        thumbUrl: buildThumbFromSecureUrl(url),
      }));

      const photoUrl = gallery[0]?.url || "";
      const thumbUrl = gallery[0]?.thumbUrl || "";

      return {
        // === CardV1 ===
        id: String(n._id),
        name: n.nombre,
        category: n.categoria || "",
        photoUrl,          // portada
        thumbUrl,          // miniatura
        rating: n.rating ?? 0,
        reviews: n.reviews ?? 0,

        // Opcionales (si los usas)
        logoUrl: n.logoUrl || "",
        badges: Array.isArray(n.badges) ? n.badges : [],
        isOpen: typeof isCurrentlyOpen === "function" ? isCurrentlyOpen(n.closingTime) : true,
        closingTime: n.closingTime || "",
        description: n.descripcion || "",
        promoText: n.promoText || "",
        promoExpiresAt: n.promoExpiresAt || null,
        priceLevel: n.priceLevel || 1,

        // Galería limitada por plan (4/8/15)
        gallery,

        // Puedes seguir devolviendo distanceKm si ya lo calculas
        // distanceKm: ...
        isFavorite: false,
      };
    });


    res.json({ ok: true, page, limit, total, items: mapped });
  } catch (err) {
    return next(err);
  }
};

/**
 * Crea un negocio básico
 */
exports.crearNegocio = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const clean = (s) => String(s || "").trim();

    const nombre = clean(req.body?.nombre);
    const categoria = clean(req.body?.categoria); // puede ser nombre o slug
    const subcategoria = clean(req.body?.subcategoria || "");
    const ciudad = clean(req.body?.ciudad);
    const whatsapp = clean(req.body?.whatsapp || "");

    if (!nombre || !categoria || !ciudad) {
      return res.status(400).json({ mensaje: "Faltan campos obligatorios" });
    }

    const catSlug = canonicalCategoria(categoria);
    if (!catSlug) {
      return res.status(400).json({ mensaje: "Categoría inválida" });
    }
    const subcatSlug = subcategoria ? canonicalSubcat(subcategoria) : "";

// Blindaje: subcategoría debe pertenecer al grupo
if (subcategoria) {
  const allowed = SUBCAT_INDEX.get(catSlug);
  if (allowed && !allowed.has(subcatSlug)) {
    return res.status(400).json({ mensaje: "Subcategoría inválida para este grupo" });
  }
}


    const u = await Usuario.findById(uid).lean();
    if (!u || String(u.tipo) !== "comerciante") {
      return res.status(403).json({ mensaje: "Solo comerciantes pueden publicar negocios" });
    }

    // Límite de negocios activos por plan
    const maxBusinesses = Number(u.perfil) === 1 ? 1 : Number(u.perfil) === 2 ? 3 : 10;
    const activos = await Negocio.countDocuments({ usuarioId: uid, activo: true });
    if (activos >= maxBusinesses) {
      return res.status(403).json({ mensaje: "Has alcanzado el límite de negocios activos para tu plan" });
    }

    const creado = await Negocio.create({
      usuarioId: uid,
      nombre,
      categoria,          // etiqueta humana si la envían
      categoriaSlug: catSlug,
      subcategoria,
      subcategoriaSlug: subcatSlug,
      ciudad,
      whatsapp,
    });

    return res.status(201).json({ ok: true, negocio: creado });
  } catch (err) {
    return next(err);
  }
};

/**
 * Conteo de negocios activos del comerciante autenticado
 */
exports.conteoMisNegocios = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
    const count = await Negocio.countDocuments({ usuarioId: uid, activo: true });
    return res.json({ ok: true, count });
  } catch (err) {
    return next(err);
  }
};

/**
 * Lista mis negocios
 */
exports.listarMisNegocios = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Negocio.find({ usuarioId: uid }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Negocio.countDocuments({ usuarioId: uid }),
    ]);

    res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    return next(err);
  }
};

/**
 * Activar / desactivar
 */
exports.toggleActivo = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    const id = req.params.id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const n = await Negocio.findOne({ _id: id, usuarioId: uid });
    if (!n) return res.status(404).json({ mensaje: "No encontrado" });

    n.activo = !n.activo;
    await n.save();
    res.json({ ok: true, negocio: n });
  } catch (err) {
    return next(err);
  }
};

/**
 * Editar negocio (normaliza categoría y subcategoría si llegan)
 */
exports.editarNegocio = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    const id = req.params.id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const n = await Negocio.findOne({ _id: id, usuarioId: uid });
    if (!n) return res.status(404).json({ mensaje: "No encontrado" });

    const clean = (s) => String(s ?? "").trim();
    const updatable = ["nombre", "categoria", "subcategoria", "ciudad", "whatsapp", "telefono", "direccion", "descripcion"];

    updatable.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = clean(req.body[key]);
        if ((key === "nombre" || key === "categoria" || key === "ciudad") && val === "") return;
        n[key] = val;
      }
    });

    // Normalizar slugs si llegaron cambios de categoría/subcategoría
    if (Object.prototype.hasOwnProperty.call(req.body, "categoria")) {
      const catSlug = canonicalCategoria(n.categoria || req.body.categoria);
      if (!catSlug) return res.status(400).json({ mensaje: "Categoría inválida" });
      n.categoriaSlug = catSlug;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "subcategoria")) {
      n.subcategoriaSlug = n.subcategoria ? canonicalSubcat(n.subcategoria) : "";
    }

    
// Blindaje: si hay subcategoría, validar que pertenezca al grupo
if (n.subcategoria) {
  const _subSlug = canonicalSubcat(n.subcategoria);
  const _allowed = SUBCAT_INDEX.get(n.categoriaSlug);
  if (_allowed && !_allowed.has(_subSlug)) {
    return res.status(400).json({ mensaje: "Subcategoría inválida para este grupo" });
  }
  n.subcategoriaSlug = _subSlug;
}
if (!n.nombre || !n.categoriaSlug || !n.ciudad) {
      return res.status(400).json({ mensaje: "Los campos nombre, categoría y ciudad son obligatorios" });
    }

    await n.save();
    return res.json({ ok: true, negocio: n });
  } catch (err) {
    return next(err);
  }
};

/**
 * Borrar negocio
 */
exports.borrarNegocio = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    const id = req.params.id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const eliminado = await Negocio.findOneAndDelete({ _id: id, usuarioId: uid });
    if (!eliminado) return res.status(404).json({ mensaje: "No encontrado" });

    return res.json({ ok: true, eliminado: true, id });
  } catch (err) {
    return next(err);
  }
};

/**
 * Actualizar fotos
 */
exports.actualizarFotosNegocio = async (req, res, next) => {
  try {
    const uid = req.usuarioId || req.usuario?._id;
    const id = req.params.id;
    if (!uid) return res.status(401).json({ mensaje: "No autenticado" });

    const n = await Negocio.findOne({ _id: id, usuarioId: uid });
    if (!n) return res.status(404).json({ mensaje: "No encontrado" });

    const u = await Usuario.findById(uid).lean();
    const maxFotos = maxFotosDetailByPerfil(u?.perfil);

    const body = req.body || {};
    let fotos = Array.isArray(n.fotos) ? [...n.fotos] : [];

    if (Array.isArray(body.replace)) {
      fotos = body.replace.filter(Boolean);
    }

    if (Array.isArray(body.add) && body.add.length) {
      const set = new Set(fotos);
      for (const url of body.add) set.add(String(url || ""));
      fotos = [...set].filter(Boolean);
    }

    if (Array.isArray(body.remove) && body.remove.length) {
      const del = new Set(body.remove.filter(Boolean));
      fotos = fotos.filter((u) => !del.has(u));
    }

    if (Array.isArray(body.order) && body.order.length) {
      const map = new Map(fotos.map((u) => [u, true]));
      const ordered = [];
      for (const u of body.order) if (map.has(u)) ordered.push(u);
      for (const u of fotos) if (!ordered.includes(u)) ordered.push(u);
      fotos = ordered;
    }

    if (fotos.length > maxFotos) {
      return res.status(403).json({ mensaje: `Tu plan solo permite ${maxFotos} fotos.` });
    }

    n.fotos = fotos;
    await n.save();

    const fotosConThumb = fotos.map((url) => ({
      url,
      thumbUrl: buildThumbFromSecureUrl(url),
    }));

    return res.json({
      ok: true,
      negocio: {
        ...n.toObject(),
        fotos: fotosConThumb,
      },
      remainingSlots: Math.max(0, maxFotos - fotos.length),
      maxFotos,
    });
  } catch (err) {
    return next(err);
  }
};

/* =================== Obtener negocio por ID =================== */
exports.obtenerNegocioPorId = async (req, res, next) => {
  try {
    const id = req.params.id;
    const n = await Negocio.findById(id).lean();
    if (!n) return res.status(404).json({ mensaje: "No encontrado" });
    if (n.activo === false) return res.status(403).json({ mensaje: "No disponible" });

    const owner = await Usuario.findById(n.usuarioId, "perfil").lean();
    const maxDetail = maxFotosDetailByPerfil(owner?.perfil);
    const fotosRaw = Array.isArray(n.fotos) ? n.fotos.slice(0, maxDetail) : [];

    const portada = fotosRaw[0] || "";
    const thumbUrl = portada ? buildThumbFromSecureUrl(portada) : "";

    const fotosConThumb = fotosRaw.map((url) => ({
      url,
      thumbUrl: buildThumbFromSecureUrl(url),
    }));


    return res.json({
      ok: true,
      negocio: {
        id: String(n._id),
        nombre: n.nombre,
        categoria: n.categoria || "",
        categoriaSlug: n.categoriaSlug || "",
        subcategoria: n.subcategoria || "",
        subcategoriaSlug: n.subcategoriaSlug || "",
        ciudad: n.ciudad,
        telefono: n.telefono || n.whatsapp || "",
        direccion: n.direccion || "",
        descripcion: n.descripcion || "",
        fotos: fotosConThumb,
        portada,
        thumbUrl,
        activo: n.activo !== false,
        createdAt: n.createdAt,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/** Helpers */
function parseBool(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toObjectId(id) { try { return id; } catch { return null; } }

/**
 * GET /api/negocios
 * Soporta:
 *   - ?mine=1           => negocios del usuario autenticado
 *   - ?estado=publicado => (opcional) filtra por estado si tu modelo lo usa
 *   - ?activo=1         => (opcional) filtra activo=true/false
 *   - ?limit, ?page     => paginación
 * Devuelve por defecto { id, nombre } para poblar selects.
 */
exports.listarNegocios = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const skip  = (page - 1) * limit;

    const filter = {};
    if (String(req.query.mine || "") === "1") {
      const uid = req.usuarioId || req.usuario?._id;
      if (!uid) return res.status(401).json({ mensaje: "No autenticado" });
      filter.usuarioId = uid;
    }
    if (typeof req.query.activo !== "undefined") {
      filter.activo = parseBool(req.query.activo);
    }
    if (typeof req.query.estado !== "undefined" && String(req.query.estado).trim()) {
      // Sólo aplica si tu colección maneja el campo 'estado'
      filter.estado = String(req.query.estado).trim();
    }

    // Proyección mínima para selects
    const projection = "_id nombre activo estado logoUrl";

    const items = await Negocio.find(filter).sort({ nombre: 1 }).skip(skip).limit(limit).select(projection).lean();
    const mapped = items.map(n => ({
      id: String(n._id),
      nombre: n.nombre,
      activo: n.activo !== false,
      estado: n.estado || undefined,
      logoUrl: n.logoUrl || undefined,
    }));

    return res.json({ ok: true, page, limit, items: mapped });
  } catch (err) {
    return next(err);
  }
};