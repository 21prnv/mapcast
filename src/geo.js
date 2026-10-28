import polylabel from 'polylabel';
import { cachedFetch } from './cache.js';

// Natural Earth (public domain). The point-of-view files draw disputed borders the way
// that country officially does, e.g. `ind` shows all of Kashmir as part of India.
const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
export const POVS = ['arg', 'bdg', 'bra', 'chn', 'deu', 'egy', 'esp', 'fra', 'gbr', 'grc', 'idn', 'ind',
  'isr', 'ita', 'jpn', 'kor', 'mar', 'nep', 'nld', 'pak', 'pol', 'prt', 'pse', 'rus', 'sau', 'swe',
  'tur', 'twn', 'ukr', 'usa', 'vnm'];

const ALIASES = {
  us: 'USA', america: 'USA', 'united states of america': 'USA',
  uk: 'GBR', britain: 'GBR', 'great britain': 'GBR', england: 'GBR',
  uae: 'ARE', 'south korea': 'KOR', 'north korea': 'PRK', russia: 'RUS',
  'czech republic': 'CZE', 'ivory coast': 'CIV', burma: 'MMR',
};

const datasets = new Map();

export async function loadCountries(pov = 'default') {
  if (datasets.has(pov)) return datasets.get(pov);
  const name = pov === 'default' ? 'ne_10m_admin_0_countries' : `ne_10m_admin_0_countries_${pov}`;
  const buf = await cachedFetch(`${NE_BASE}${name}.geojson`, `natural-earth/${name}.geojson`);
  const fc = JSON.parse(buf.toString('utf8'));
  datasets.set(pov, fc.features);
  return fc.features;
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function findCountry(features, query) {
  const q = norm(query);
  const code = ALIASES[q] || (q.length <= 3 ? q.toUpperCase() : null);
  const keys = ['ADMIN', 'NAME', 'NAME_LONG', 'NAME_EN', 'FORMAL_EN', 'SOVEREIGNT'];
  const codes = ['ADM0_A3', 'ISO_A3', 'ISO_A3_EH', 'ISO_A2', 'ISO_A2_EH', 'GU_A3', 'SU_A3'];
  let hit = code && features.find((f) => codes.some((k) => f.properties[k] === code));
  hit ||= features.find((f) => keys.some((k) => norm(f.properties[k]) === q));
  hit ||= features.find((f) => keys.some((k) => norm(f.properties[k]).startsWith(q)));
  if (!hit) throw new Error(`Unknown country "${query}". Use a name ("India") or ISO code ("IN", "IND").`);
  return hit;
}

// Pick the border view: the highlighted country's own official view when Natural Earth has one.
export async function resolveCountries(queries, pov = 'auto') {
  let features = await loadCountries('default');
  if (pov === 'auto') {
    const own = [...new Set(queries.map((q) => findCountry(features, q).properties.ADM0_A3.toLowerCase()))];
    pov = own.length === 1 && POVS.includes(own[0]) ? own[0] : 'default';
  }
  if (pov !== 'default') features = await loadCountries(pov);
  return { all: features, matched: queries.map((q) => findCountry(features, q)) };
}

// Web Mercator, in pixels of a 256px tile world at zoom 0.
export function project([lon, lat]) {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256];
}

const polygonsOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

const bboxOf = (rings) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const [x, y] of ring) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
};

let places;
async function loadPlaces() {
  if (places) return places;
  const name = 'ne_50m_populated_places_simple';
  const buf = await cachedFetch(`${NE_BASE}${name}.geojson`, `natural-earth/${name}.geojson`);
  places = JSON.parse(buf.toString('utf8')).features.map((f) => f.properties);
  return places;
}

// The capital by default, or a named city in that country. Returns { name, point } or null.
export async function findCity(code, which = true) {
  const all = (await loadPlaces()).filter((p) => p.adm0_a3 === code);
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  let hit;
  if (which === true) {
    hit = all.filter((p) => p.featurecla === 'Admin-0 capital' && p.adm0cap === 1).sort((a, b) => b.pop_max - a.pop_max)[0];
  } else {
    const q = norm(which);
    hit = all.find((p) => [p.name, p.nameascii, p.namealt].some((n) => norm(n) === q));
  }
  return hit ? { name: clean(hit.name), lonlat: [hit.longitude, hit.latitude] } : null;
}

// Drop points closer together than `tol` (projected units); keeps rings closed and at least 4 points.
function simplify(ring, tol) {
  if (ring.length <= 8) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const p = out[out.length - 1];
    if (Math.abs(ring[i][0] - p[0]) + Math.abs(ring[i][1] - p[1]) >= tol) out.push(ring[i]);
  }
  out.push(ring[ring.length - 1]);
  return out.length >= 4 ? out : ring;
}

// Every country overlapping `box` (projected), for land masks, paper maps and neighbour borders.
// Rings are unwrapped around `centerLon` so the area near the antimeridian stays continuous.
export function contextCountries(features, box, centerLon, tol) {
  const out = [];
  for (const f of features) {
    const polygons = [];
    for (const poly of polygonsOf(f.geometry)) {
      const rings = poly.map((ring) => {
        const mid = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const shift = 360 * Math.round((centerLon - mid) / 360);
        return ring.map(([lon, lat]) => project([lon + shift, lat]));
      });
      const b = bboxOf([rings[0]]);
      if (b[2] < box[0] || b[0] > box[2] || b[3] < box[1] || b[1] > box[3]) continue;
      if (Math.max(b[2] - b[0], b[3] - b[1]) < tol * 2) continue;
      polygons.push(rings.map((r) => simplify(r, tol)));
    }
    if (polygons.length) out.push({ code: f.properties.ADM0_A3, polygons });
  }
  return out;
}

// Turn a country feature into projected polygons plus framing hints. Longitudes are unwrapped
// around the mainland so countries crossing the antimeridian (USA, Russia, Fiji) stay in one piece.
export function prepareCountry(feature) {
  const polys = polygonsOf(feature.geometry);
  const mainland = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const center = mainland[0].reduce((s, p) => s + p[0], 0) / mainland[0].length;
  const unwrap = ([lon, lat]) => [lon - center > 180 ? lon - 360 : lon - center < -180 ? lon + 360 : lon, lat];
  const polygons = polys.map((poly) => poly.map((ring) => ring.map((p) => project(unwrap(p)))));
  const main = mainland.map((ring) => ring.map((p) => project(unwrap(p))));
  // Small far-off islands (Hawaii, Andaman) should not shrink the shot, so frame on polygons that
  // hold a meaningful share of the area and sit reasonably close to the mainland.
  const mainArea = ringArea(main[0]);
  const mb = bboxOf(main);
  const span = Math.max(mb[2] - mb[0], mb[3] - mb[1]);
  const framed = polygons.filter((p) => {
    if (p === polygons[polys.indexOf(mainland)]) return true;
    const b = bboxOf(p);
    const m = span * 0.1;
    const near = b[0] < mb[2] + m && b[2] > mb[0] - m && b[1] < mb[3] + m && b[3] > mb[1] - m;
    return near && ringArea(p[0]) > mainArea * 0.002;
  });
  const lp = polylabel(main, Math.max(0.001, span / 400));
  const iso2 = [feature.properties.ISO_A2_EH, feature.properties.ISO_A2].find((c) => c && c !== '-99');
  return {
    name: feature.properties.NAME,
    code: feature.properties.ADM0_A3,
    iso2: iso2?.toLowerCase(),
    centerLon: center,
    polygons,
    frameBox: bboxOf(framed.flat()),
    fullBox: bboxOf(polygons.flat()),
    labelPoint: [lp[0], lp[1]],
    labelWidth: Math.min(mb[2] - mb[0], (lp.distance || span / 6) * 3.2),
  };
}
