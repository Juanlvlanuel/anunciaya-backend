// controllers/geoController.js
// Valida ciudades y resuelve ciudad por coordenadas usando Nominatim (OpenStreetMap).
// Evita CORS haciendo las solicitudes desde el backend.
const fetch = global.fetch || require("node-fetch");

const VALID_TYPES = new Set(["city", "town", "village", "municipality", "borough"]);

function buildSearchUrl(q, country) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  if (country) url.searchParams.set("countrycodes", String(country).toLowerCase());
  return url.toString();
}

function buildReverseUrl(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("zoom", "10"); // nivel ciudad
  addressdetails = "1";
  url.searchParams.set("addressdetails", "1");
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
    entry.name ||
    "";
  return String(name);
}

async function verifyCity(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    const country = (req.query.country || req.query.countrycodes || "").trim();
    if (!q) return res.status(400).json({ valid: false, error: "q requerido" });

    const r = await fetch(buildSearchUrl(q, country), {
      headers: {
        "Accept": "application/json",
        "User-Agent": process.env.NOMINATIM_UA || "AnunciaYA/1.0 (localhost)",
      },
    });
    if (!r.ok) return res.status(502).json({ valid: false, error: "upstream" });
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return res.json({ valid: false });

    const first = data[0] || {};
    const typ = String(first.type || "").toLowerCase();
    const valid = VALID_TYPES.has(typ);
    const normalized = normalizeName(first);
    return res.json({ valid, normalized });
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
    return res.json({ ok: true, valid, city: name, type: typ, raw: undefined });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server" });
  }
}

module.exports = { verifyCity, reverseCity };
