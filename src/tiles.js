import { cachedFetch } from './cache.js';

const GIBS = (layer) => (z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
// Sentinel-2 cloudless 2016 by EOX, CC BY 4.0. Later years are NonCommercial, so stay on 2016.
// Its low zooms have blocky seams over Asia, so it only takes over past Blue Marble's zoom 8.
const EOX = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;

const NASA = 'NASA Blue Marble (public domain, via NASA GIBS)';
const EOX_CREDIT = 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0';

// Free basemaps whose licences allow reuse in published videos. Each is a list of sources by zoom range.
export const BASEMAPS = {
  satellite: {
    sources: [{ upTo: 8, url: GIBS('BlueMarble_ShadedRelief_Bathymetry'), credit: NASA }, { upTo: 14, url: EOX, credit: EOX_CREDIT }],
  },
  bluemarble: { sources: [{ upTo: 8, url: GIBS('BlueMarble_NextGeneration'), credit: NASA }] },
  sentinel: { sources: [{ upTo: 14, url: EOX, credit: EOX_CREDIT }] },
};

export function getBasemap(name) {
  const b = BASEMAPS[name];
  if (!b) throw new Error(`Unknown basemap "${name}". Available: ${Object.keys(BASEMAPS).join(', ')}`);
  return { maxZoom: b.sources.at(-1).upTo, sources: b.sources };
}

// Credits for the sources a render actually used.
export function attribution(name, zooms) {
  const used = getBasemap(name).sources.filter((s, i, all) => zooms.some((z) => z <= s.upTo && (i === 0 || z > all[i - 1].upTo)));
  return [...new Set(used.map((s) => s.credit))].join('; ');
}

export async function fetchTile(name, z, x, y) {
  const source = getBasemap(name).sources.find((s) => z <= s.upTo);
  const n = 2 ** z;
  const wx = ((x % n) + n) % n;
  if (!source || y < 0 || y >= n) return null;
  return cachedFetch(source.url(z, wx, y), `tiles/${name}/${z}/${wx}/${y}.jpg`);
}
