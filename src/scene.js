// Scene format: what an AI (or a person) writes. Everything except `highlights` is optional.

export const STYLES = ['solid', 'highlight', 'outline'];
export const MOVES = ['push-in', 'zoom-in', 'static'];
export const GRADES = ['natural', 'muted', 'mono'];

const NAMED_COLORS = {
  red: '#c8102e', crimson: '#b01030', yellow: '#ffd400', gold: '#f2b705', orange: '#ff7a00',
  green: '#1fa34a', teal: '#0fa3a3', blue: '#1e63ff', navy: '#12307a', purple: '#7b2cbf',
  pink: '#ff4f9a', white: '#ffffff', black: '#000000',
};

// Default colours when several countries are highlighted without a colour each.
const PALETTE = ['#c8102e', '#1e63ff', '#ffd400', '#1fa34a', '#ff7a00', '#7b2cbf', '#0fa3a3', '#ff4f9a'];

const SIZES ={ '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

const fail = (msg) => { throw new Error(`Invalid scene: ${msg}`); };
const color = (c, fallback) => (c == null ? fallback : NAMED_COLORS[String(c).toLowerCase()] || String(c));

export function normalizeScene(input) {
  if (!input || typeof input !== 'object') fail('expected a JSON object');
  const list = input.highlights ?? (input.country ? [input] : null);
  if (!Array.isArray(list) || !list.length) fail('add "highlights": [{ "country": "India" }]');

  let [width, height] = SIZES[input.aspect ?? '16:9'] ?? fail(`aspect must be one of ${Object.keys(SIZES).join(', ')}`);
  width = input.width ?? width;
  height = input.height ?? height;
  const duration = input.duration ?? 5;
  if (!(duration > 0 && duration <= 120)) fail('duration must be between 0 and 120 seconds');

  const cam = typeof input.camera === 'string' ? { move: input.camera } : input.camera ?? {};
  const move = cam.move ?? 'push-in';
  if (!MOVES.includes(move)) fail(`camera.move must be one of ${MOVES.join(', ')}`);

  const effects = input.effects ?? {};
  const grade = effects.grade ?? 'natural';
  if (!GRADES.includes(grade)) fail(`effects.grade must be one of ${GRADES.join(', ')}`);

  const highlights = list.map((h, i) => {
    if (typeof h === 'string') h = { country: h };
    if (!h.country) fail(`highlights[${i}] needs "country"`);
    const style = h.style ?? input.style ?? 'solid';
    if (!STYLES.includes(style)) fail(`highlights[${i}].style must be one of ${STYLES.join(', ')}`);
    const fill = color(h.color, style === 'highlight' && i === 0 ? NAMED_COLORS.yellow : PALETTE[i % PALETTE.length]);
    const border = h.border === false ? null : {
      color: color(h.border?.color, '#ffffff'),
      width: h.border?.width ?? 3,
      glow: h.border?.glow ?? (style === 'solid' ? 0.35 : 0.8),
      glowColor: h.border?.glowColor ? color(h.border.glowColor) : undefined,
    };
    return {
      country: h.country,
      style,
      color: fill,
      opacity: h.opacity ?? 0.92,
      label: h.label === false ? null : h.label ?? null, // filled with the country name later
      labelColor: color(h.labelColor, '#ffffff'),
      labelWeight: h.labelWeight ?? 700,
      border,
      start: h.start,
    };
  });

  return {
    width, height, duration,
    fps: input.fps ?? 30,
    basemap: input.basemap ?? 'satellite',
    pov: input.pov ?? 'auto',
    camera: { move, fill: cam.fill ?? 0.72, from: cam.from ?? 0.2 },
    effects: { grade, vignette: effects.vignette ?? 0.45 },
    highlights,
  };
}
