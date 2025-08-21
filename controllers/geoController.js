// controllers/geoController.js
// Valida ciudades y resuelve ciudad por coordenadas usando Nominatim (OpenStreetMap).
// Mejoras: acepta boundary/administrative (admin_level 6-10), forzado a MX por defecto,
// y normaliza acentos para coincidencias más robustas.
const fetch = global.fetch || require("node-fetch");

const VALID_TYPES = new Set(["city", "town", "village", "municipality", "borough"]);
const VALID_BOUNDARY = new Set(["administrative", "political"]);

function buildSearchUrl(q, country) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "es");
  if (country) url.searchParams.set("countrycodes", String(country).toLowerCase());
  return url.toString();
}

function buildReverseUrl(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("zoom", "10"); // nivel ciudad aproximado
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "es");
  return url.toString();
}

function normalizeName(entry) {
  if (!entry) return "";
  const addr = entry.address || {};
  const name =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.city_district ||
    addr.state_district ||
    addr.county ||
    entry.name ||
    "";
  return String(name);
}

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pickBestCandidate(list, q) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const qn = stripAccents(q);
  // 1) Prefer direct valid types
  const direct = list.find((e) => VALID_TYPES.has(String(e.type || "").toLowerCase()));
  if (direct) return direct;
  // 2) Try boundary/administrative with city-like address & admin_level 6-10
  const boundary = list.find((e) => {
    const cls = String(e.class || "").toLowerCase();
    const typ = String(e.type || "").toLowerCase();
    const al = Number(e.extratags?.admin_level || e.admin_level || e.address?.admin_level || 0);
    const name = normalizeName(e);
    return (cls === "boundary" && VALID_BOUNDARY.has(typ) && al >= 6 && al <= 10 && name);
  });
  if (boundary) return boundary;
  // 3) Fallback: the one whose normalized name matches query best
  let best = list[0];
  for (const e of list) {
    const name = normalizeName(e);
    if (stripAccents(name) === qn) return e;
    // keep the first with a city-like name
    if (name && !best) best = e;
  }
  return best;
}

async function verifyCity(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    // Por defecto México; se puede sobrescribir con ?country=xx
    const country = (req.query.country || req.query.countrycodes || "mx").trim();
    if (!q) return res.status(400).json({ valid: false, error: "q requerido" });

    const r = await fetch(buildSearchUrl(q, country), {
      headers: {
        "Accept": "application/json",
        "User-Agent": process.env.NOMINATIM_UA || "AnunciaYA/1.0 (localhost)",
      },
    });
    if (!r.ok) return res.status(502).json({ valid: false, error: "upstream" });
    const data = await r.json();

    const candidate = pickBestCandidate(data, q);
    if (!candidate) return res.json({ valid: false });

    const typ = String(candidate.type || "").toLowerCase();
    const cls = String(candidate.class || "").toLowerCase();
    const normalized = normalizeName(candidate);

    // Aceptamos tipos directos, o boundary administrativo con nombre de ciudad.
    const al = Number(candidate.extratags?.admin_level || candidate.admin_level || candidate.address?.admin_level || 0);
    const isAdminOk = (cls === "boundary" && VALID_BOUNDARY.has(typ) && al >= 6 && al <= 10 && !!normalized);

    const valid = VALID_TYPES.has(typ) || isAdminOk || !!normalized;
    return res.json({ valid: !!valid, normalized });
  } catch (e) {
    return res.status(500).json({ valid: false, error: "server" });
  }
}

async function reverseCity(req, res) {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon)) {
      return res.status(400).json({ ok: false, error: "lat/lon requeridos" });
    }
    const r = await fetch(buildReverseUrl(lat, lon), {
      headers: {
        "Accept": "application/json",
        "User-Agent": process.env.NOMINATIM_UA || "AnunciaYA/1.0 (localhost)",
      },
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: "upstream" });
    const data = await r.json();

    const typ = String(data?.type || data?.addresstype || "").toLowerCase();
    const name = normalizeName(data);
    const valid = !!name;
    return res.json({ ok: true, valid, city: name, type: typ });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server" });
  }
}

module.exports = { verifyCity, reverseCity };



async function autocomplete(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    // Forzar MX por defecto (se puede sobrescribir con ?country=XX)
    const country = (req.query.country || req.query.countrycodes || "mx").trim();
    if (!q || q.length < 2) return res.json({ items: [] });

    // Helper de normalización y nombre
    const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const qn = strip(q);

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("limit", "10");
    url.searchParams.set("accept-language", "es");
    if (country) url.searchParams.set("countrycodes", String(country).toLowerCase());
    // Sesgo a México (viewbox nacional) y bounded=1 para relevancia
    // viewbox: W,S,E,N
    if (!req.query.viewbox) {
      url.searchParams.set("viewbox", "-118.5,14.3,-86.5,33.4");
      url.searchParams.set("bounded", "1");
    }

    const r = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": process.env.NOMINATIM_UA || "AnunciaYA/1.0 (localhost)",
      },
    });
    if (!r.ok) return res.status(502).json({ items: [] });

    const data = await r.json();

    // Solo MX y tipos ciudad/municipio
    const isCityLike = (e) => {
      const typ = String(e.type || "").toLowerCase();
      const cls = String(e.class || "").toLowerCase();
      return ["city","town","village","municipality","borough"].includes(typ) ||
             (cls === "boundary" && ["administrative","political"].includes(typ));
    };

    const itemsAll = (Array.isArray(data) ? data : []).filter((e) => {
      const cc = String(e.address?.country_code || "").toLowerCase();
      if (country && cc !== String(country).toLowerCase()) return false;
      const name = normalizeName(e);
      if (!name) return false;
      return isCityLike(e);
    });

    // Ranking por relevancia: empieza con / contiene + importance
    const score = (e) => {
      const name = normalizeName(e);
      const nn = strip(name);
      if (!nn) return -1;
      if (nn.startsWith(qn)) return 200 - nn.length;
      if (nn.includes(qn)) return 120 - nn.indexOf(qn);
      return Number(e.importance || 0);
    };

    itemsAll.sort((a,b) => score(b) - score(a));

    const items = itemsAll.slice(0, 7).map((e) => ({
      name: normalizeName(e),
      type: String(e.type || ""),
      lat: e.lat,
      lon: e.lon,
      display: e.display_name,
    }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ items: [] });
  }
}


module.exports = { verifyCity, reverseCity, autocomplete };
