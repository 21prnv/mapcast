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
  return queries.map((q) => findCountry(features, q));
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
  return {
    name: feature.properties.NAME,
    code: feature.properties.ADM0_A3,
    polygons,
    frameBox: bboxOf(framed.flat()),
    fullBox: bboxOf(polygons.flat()),
    labelPoint: [lp[0], lp[1]],
    labelWidth: Math.min(mb[2] - mb[0], (lp.distance || span / 6) * 3.2),
  };
}
