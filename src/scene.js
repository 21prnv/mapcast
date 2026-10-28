// Scene format: what an AI (or a person) writes. Everything except `highlights` (or `data`) is optional.

export const STYLES = ['solid', 'highlight', 'outline', 'flag'];
export const MOVES = ['push-in', 'zoom-in', 'static'];
export const GRADES = ['natural', 'muted', 'mono'];
export const LABEL_ANIMS = ['rise', 'type', 'spread', 'slide', 'pop'];
export const SCHEMES = {
  reds: ['#fde0d6', '#a50f15'],
  blues: ['#dbe9f6', '#08306b'],
  greens: ['#e0f3db', '#00441b'],
  heat: ['#ffe14d', '#b30000'],
  purples: ['#ece2f0', '#4a1486'],
  diverging: ['#2166ac', '#f7f7f7', '#b2182b'],
};

const NAMED_COLORS = {
  red: '#c8102e', crimson: '#b01030', yellow: '#ffd400', gold: '#f2b705', orange: '#ff7a00',
  green: '#1fa34a', teal: '#0fa3a3', blue: '#1e63ff', navy: '#12307a', purple: '#7b2cbf',
  pink: '#ff4f9a', white: '#ffffff', black: '#000000',
};

// Default colours when several countries are highlighted without a colour each.
const PALETTE = ['#c8102e', '#1e63ff', '#ffd400', '#1fa34a', '#ff7a00', '#7b2cbf', '#0fa3a3', '#ff4f9a'];

// Muted ink colours that sit naturally on the paper basemap.
const PAPER_PALETTE = ['#a3221b', '#2f5d7c', '#c08a1e', '#4f6b2f', '#6b3d6e', '#b5562a'];

const SIZES ={ '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

const fail = (msg) => { throw new Error(`Invalid scene: ${msg}`); };
const color = (c, fallback) => (c == null ? fallback : NAMED_COLORS[String(c).toLowerCase()] || String(c));
const oneOf = (value, list, field) => (list.includes(value) ? value : fail(`${field} must be one of ${list.join(', ')}`));

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function ramp(stops, t) {
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const local = t * (stops.length - 1) - seg;
  const [a, b] = [hex(stops[seg]), hex(stops[seg + 1])];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * local).toString(16).padStart(2, '0')).join('')}`;
}

const formatNumber = (v) => {
  const abs = Math.abs(v);
  return Number(v.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)).toLocaleString('en-US');
};

// data.labels: true/"name" shows the country, "value" the number, "both" the country over the number.
function dataLabel(data, country, v) {
  const value = `${data.prefix ?? ''}${formatNumber(v)}${data.unit ?? ''}`;
  const mode = data.labels === true ? 'name' : data.labels;
  if (mode === 'name') return country.toUpperCase();
  if (mode === 'value') return value;
  if (mode === 'both') return `${country.toUpperCase()}\n${value}`;
  if (mode) fail('data.labels must be true, "name", "value" or "both"');
  return false;
}

// `data` turns numbers into a coloured map: { values: { India: 3.9, China: 18 }, scheme: "reds", title: "GDP ($T)" }.
function dataHighlights(data) {
  const entries = Object.entries(data.values ?? {});
  if (!entries.length) fail('data.values needs at least one { "Country": number }');
  const nums = entries.map(([, v]) => Number(v));
  if (nums.some((v) => !Number.isFinite(v))) fail('data.values must all be numbers');
  const min = data.min ?? Math.min(...nums);
  const max = data.max ?? Math.max(...nums);
  const stops = Array.isArray(data.scheme) ? data.scheme.map((c) => color(c)) : SCHEMES[data.scheme ?? 'reds'] ?? fail(`data.scheme must be one of ${Object.keys(SCHEMES).join(', ')} or a list of colours`);
  const highlights = entries.map(([country, v], i) => ({
    country,
    style: 'solid',
    color: ramp(stops, max === min ? 1 : Math.max(0, Math.min(1, (v - min) / (max - min)))),
    label: dataLabel(data, country, Number(v)),
    border: { width: 1.5, glow: 0 },
    start: 0.3 + (i % 12) * 0.05,
  }));
  return { highlights, legend: { title: data.title ?? '', min, max, stops, prefix: data.prefix ?? '', unit: data.unit ?? '' } };
}

export function normalizeScene(input) {
  if (!input || typeof input !== 'object') fail('expected a JSON object');
  const fromData = input.data ? dataHighlights(input.data) : null;
  const list = fromData ? [...fromData.highlights, ...(input.highlights ?? [])] : input.highlights ?? (input.country ? [input] : null);
  if (!Array.isArray(list) || !list.length) fail('add "highlights": [{ "country": "India" }] or "data": { "values": {...} }');

  let [width, height] = SIZES[input.aspect ?? '16:9'] ?? fail(`aspect must be one of ${Object.keys(SIZES).join(', ')}`);
  width = input.width ?? width;
  height = input.height ?? height;
  const duration = input.duration ?? 5;
  if (!(duration > 0 && duration <= 120)) fail('duration must be between 0 and 120 seconds');

  const basemap = input.basemap ?? 'satellite';
  const paper = basemap === 'paper';
  const cam = typeof input.camera === 'string' ? { move: input.camera } : input.camera ?? {};
  const move = oneOf(cam.move ?? 'push-in', MOVES, 'camera.move');

  const effects = input.effects ?? {};
  const grid = effects.grid === true ? {} : effects.grid || null;

  const highlights = list.map((h, i) => {
    if (typeof h === 'string') h = { country: h };
    if (!h.country) fail(`highlights[${i}] needs "country"`);
    const style = oneOf(h.style ?? input.style ?? 'solid', STYLES, `highlights[${i}].style`);
    const palette = paper ? PAPER_PALETTE : PALETTE;
    const fill = color(h.color, style === 'highlight' && i === 0 ? NAMED_COLORS.yellow : palette[i % palette.length]);
    const ink = paper ? '#3b2a1a' : '#ffffff';
    const border = h.border === false ? null : {
      color: color(h.border?.color, ink),
      width: h.border?.width ?? (paper ? 2.5 : 3),
      glow: h.border?.glow ?? (paper ? 0 : style === 'solid' ? 0.35 : 0.8),
      glowColor: h.border?.glowColor ? color(h.border.glowColor) : undefined,
    };
    return {
      country: h.country,
      style,
      color: fill,
      opacity: h.opacity ?? (paper ? 0.75 : 0.92),
      label: h.label === false ? false : h.label ?? null, // null is filled with the country name later
      labelColor: color(h.labelColor, ink),
      labelWeight: h.labelWeight ?? 700,
      labelSize: h.labelSize ?? 1,
      labelFont: h.labelFont ?? (paper ? 'serif' : 'sans'),
      labelAnim: oneOf(h.labelAnim ?? input.labelAnim ?? 'rise', LABEL_ANIMS, `highlights[${i}].labelAnim`),
      capital: h.capital ?? false, // true for the capital, or a city name
      border,
      start: h.start,
    };
  });

  return {
    width, height, duration,
    fps: input.fps ?? 30,
    basemap,
    pov: input.pov ?? 'auto',
    camera: { move, fill: cam.fill ?? 0.72, from: cam.from ?? 0.2 },
    effects: {
      grade: oneOf(effects.grade ?? 'natural', GRADES, 'effects.grade'),
      vignette: effects.vignette ?? (paper ? 0.3 : 0.45),
      blur: effects.blur ?? 0,
      grid: grid && { step: grid.step ?? null, color: color(grid.color, paper ? '#5a4630' : '#bcd8ff'), opacity: grid.opacity ?? 0.28 },
      borders: effects.borders ?? paper,
    },
    legend: fromData?.legend ?? null,
    highlights,
  };
}
