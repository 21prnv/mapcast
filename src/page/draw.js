// Runs inside headless Chromium. Node calls mapcast.init(payload) once, then mapcast.draw(t) per frame.
// Coordinates are Web Mercator pixels at zoom 0 (the whole world is 256 units wide).

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const lerp = (a, b, t) => a + (b - a) * t;
const progress = (t, start, dur) => clamp01((t - start) / dur);

const FONTS = { sans: 'Montserrat', serif: 'Cinzel' };
const PAPER = { sea: '#d8c9a3', land: '#efe2c2', ink: '#4a3826', coast: '#7d6444' };
const GRADES = {
  natural: 'saturate(1.08) contrast(1.05) brightness(0.92)',
  muted: 'saturate(0.6) contrast(1.05) brightness(0.75)',
  mono: 'grayscale(1) contrast(1.15) brightness(0.55)',
};

let S; // normalized scene + geometry from Node
let W, H;
let camera;
let levels = []; // tile mosaics, coarse to fine: { x0, y0, scale, img }
let shapes = []; // one per highlight
let land = null; // Path2D of every nearby country, for masks and paper maps
let borderRings = [];
let paperTexture = null;
let missing = 0;
let layers = new Map(); // per-frame cache of the world drawn with a given filter
let cam;

// ---------- camera ----------

function unionBox(boxes) {
  return boxes.reduce((b, c) => [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])], [Infinity, Infinity, -Infinity, -Infinity]);
}

const fitScale = (box, fill) => Math.min((W * fill) / Math.max(box[2] - box[0], 1e-6), (H * fill) / Math.max(box[3] - box[1], 1e-6));
const center = (box) => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];

// Smooth zoom-and-pan between two views (van Wijk & Nuij, 2003): pulls back, travels, zooms in.
// Views are [cx, cy, w] with w the view width in world units. Returns { at(u), length }.
function flyPath([ux0, uy0, w0], [ux1, uy1, w1], rho = 1.4) {
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, rho2 = rho * rho, rho4 = rho2 * rho2;
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    return { length: Math.abs(S), at: (u) => [ux0, uy0, w0 * Math.exp(rho * u * S)] };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return {
    length: S,
    at: (u) => {
      const s = u * S, c0 = Math.cosh(r0);
      const q = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + q * dx, uy0 + q * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
    },
  };
}

// Returns camera(t) -> { cx, cy, k }. Moves that decide when each country appears also fill
// `cameraPlan.starts`; the globe move fills `cameraPlan.globe`.
const cameraPlan = { starts: null, globe: null };

function buildCamera() {
  const box = unionBox(S.countries.map((c) => c.frameBox));
  const [cx, cy] = center(box);
  const fill = S.camera.fill;
  const kFit = fitScale(box, fill);
  const D = S.duration;
  const drift = (box[2] - box[0]) * 0.02;
  const moves = {
    static: () => ({ cx, cy, k: kFit }),
    'push-in': (t) => {
      const p = easeInOut(clamp01(t / D));
      return { cx: cx - drift + drift * 2 * p, cy, k: kFit * lerp(0.9, 1.06, p) };
    },
    'zoom-in': (t) => {
      const p = easeInOut(clamp01(t / (D * 0.45)));
      const settle = clamp01((t - D * 0.45) / (D * 0.55));
      return { cx, cy, k: kFit * Math.exp(lerp(Math.log(S.camera.from), 0, p)) * lerp(1, 1.04, settle) };
    },
    fly: () => buildFly(),
    globe: () => buildGlobe(cx, cy, kFit),
  };
  return S.camera.move === 'fly' || S.camera.move === 'globe' ? moves[S.camera.move]() : moves[S.camera.move];
}

// Visit each highlight in order: hold on it while it animates, then fly to the next.
function buildFly() {
  const D = S.duration;
  const views = S.countries.map((c) => [...center(c.frameBox), W / fitScale(c.frameBox, S.camera.fill)]);
  const HOLD = 2.4;
  const legs = views.slice(1).map((v, i) => flyPath([views[i][0], views[i][1], views[i][2] / 1.04], v));
  const travel = legs.map((l) => Math.max(1.2, Math.min(3, Math.abs(l.length) * 0.75)));
  const scale = D / (HOLD * views.length + travel.reduce((a, b) => a + b, 0));
  const segs = [];
  let t = 0;
  views.forEach((v, i) => {
    segs.push({ kind: 'hold', t0: t, t1: (t += HOLD * scale), v });
    if (legs[i]) segs.push({ kind: 'fly', t0: t, t1: (t += travel[i] * scale), leg: legs[i] });
  });
  cameraPlan.starts = segs.filter((s) => s.kind === 'hold').map((s) => s.t0 + 0.12 * (s.t1 - s.t0));
  cameraPlan.hold = HOLD * scale;
  return (time) => {
    const seg = segs.find((s) => time < s.t1) ?? segs[segs.length - 1];
    const u = clamp01((time - seg.t0) / (seg.t1 - seg.t0));
    const [x, y, w] = seg.kind === 'hold' ? [seg.v[0], seg.v[1], seg.v[2] / lerp(1, 1.04, easeInOut(u))] : seg.leg.at(easeInOut(u));
    return { cx: x, cy: y, k: W / w };
  };
}

// Spin the Earth in space, dive towards the target, then hand over to the flat map at matching scale.
const GLOBE_ZOOM = 4; // world texture: 16x16 tiles = 4096 px
function buildGlobe(cx, cy, kFit) {
  const D = S.duration;
  const lon = (cx / 256) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / 256))) * 180) / Math.PI;
  // The flat map takes over where the world texture is still sharp, then keeps zooming to the final shot.
  const kHand = Math.min(kFit * 0.6, 2 ** GLOBE_ZOOM * 1.3);
  const rHand = (kHand * 128) / (Math.PI * Math.cos((lat * Math.PI) / 180));
  const r0 = Math.min(W, H) * 0.42;
  const tDive = D * 0.18, tHand = D * 0.42, tFade = D * 0.07, tLand = D * 0.68;
  const flat = (t) => {
    const p = easeOut(clamp01((t - tHand) / (tLand - tHand)));
    const settle = clamp01((t - tLand) / (D - tLand));
    return { cx, cy, k: Math.exp(lerp(Math.log(kHand), Math.log(kFit), p)) * lerp(1, 1.04, settle) };
  };
  const pxPerRadian = 128 / (Math.PI * Math.cos((lat * Math.PI) / 180));
  cameraPlan.starts = S.countries.map((_, i) => tLand - D * 0.06 + i * 0.4);
  cameraPlan.globe = {
    at: (t) => {
      const spin = easeOut(clamp01(t / tHand));
      const dive = easeInOut(clamp01((t - tDive) / (tHand - tDive)));
      return {
        lon: lon - 70 * (1 - spin),
        lat: lat * lerp(0.35, 1, spin),
        // After the hand-off the globe keeps the flat map's scale so the cross-fade lines up.
        r: t <= tHand ? Math.exp(lerp(Math.log(r0), Math.log(rHand), dive)) : flat(t).k * pxPerRadian,
        alpha: 1 - clamp01((t - tHand) / tFade),
      };
    },
  };
  return flat;
}

const worldTransform = (c) => [c.k, 0, 0, c.k, W / 2 - c.cx * c.k, H / 2 - c.cy * c.k];
const toScreen = ([x, y]) => [W / 2 + (x - cam.cx) * cam.k, H / 2 + (y - cam.cy) * cam.k];

// ---------- loading ----------

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Build the image pyramid the camera path needs: per zoom level, mosaics covering the views that need
// that level. Views far apart (a flight between countries) get separate mosaics instead of one huge one.
// Tiles are downloaded; paper is drawn.
async function buildMosaics() {
  const count = Math.max(61, Math.ceil(S.duration * 20));
  const samples = Array.from({ length: count }, (_, i) => camera((S.duration * i) / (count - 1)));
  const ks = samples.map((s) => s.k);
  const paper = S.basemap.kind === 'paper';
  const maxZoom = paper ? 20 : S.basemap.maxZoom;
  const zFor = (k) => Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2(k * (S.basemap.sharpness ?? 1)))));
  const zMin = zFor(Math.min(...ks));
  const zMax = zFor(Math.max(...ks));
  const jobs = [];
  for (let z = zMin; z <= zMax; z++) {
    const boxes = samples
      .filter((s) => z === zMin || zFor(s.k) >= z)
      .map((s) => [s.cx - W / 2 / s.k, s.cy - H / 2 / s.k, s.cx + W / 2 / s.k, s.cy + H / 2 / s.k]);
    for (const view of mergeBoxes(boxes)) jobs.push(...buildMosaic(z, view, paper));
  }
  await Promise.all(jobs);
  levels.sort((a, b) => a.z - b.z);
}

// Union overlapping boxes until none overlap.
function mergeBoxes(boxes) {
  const out = [];
  for (let b of boxes) {
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      if (b[0] <= o[2] && o[0] <= b[2] && b[1] <= o[3] && o[1] <= b[3]) {
        b = [Math.min(b[0], o[0]), Math.min(b[1], o[1]), Math.max(b[2], o[2]), Math.max(b[3], o[3])];
        out.splice(i, 1);
        i = out.length;
      }
    }
    out.push(b);
  }
  return out;
}

function buildMosaic(z, view, paper) {
  const n = 2 ** z; // tile pixels per zoom-0 unit
  const tx0 = Math.floor((view[0] * n) / 256);
  const ty0 = Math.max(0, Math.floor((view[1] * n) / 256));
  const tx1 = Math.floor((view[2] * n) / 256);
  const ty1 = Math.min(n - 1, Math.floor((view[3] * n) / 256));
  const mosaic = new OffscreenCanvas((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256);
  const mctx = mosaic.getContext('2d');
  const x0 = (tx0 * 256) / n, y0 = (ty0 * 256) / n;
  levels.push({ z, x0, y0, scale: 1 / n, img: mosaic });
  if (paper) {
    mctx.setTransform(n, 0, 0, n, -x0 * n, -y0 * n);
    drawPaperWorld(mctx, n, [x0, y0, x0 + mosaic.width / n, y0 + mosaic.height / n]);
    return [];
  }
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(loadImage(`/tile/${S.basemap.name}/${z}/${tx}/${ty}.jpg`).then((img) => {
        if (img) mctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256);
        else missing++;
      }));
    }
  }
  return jobs;
}

function ringLength(ring) {
  let len = 0;
  for (let i = 1; i < ring.length; i++) len += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return len;
}

function addRing(path, ring) {
  path.moveTo(ring[0][0], ring[0][1]);
  for (let j = 1; j < ring.length; j++) path.lineTo(ring[j][0], ring[j][1]);
  path.closePath();
}

async function buildShapes() {
  const n = S.highlights.length;
  const D = S.duration;
  const stagger = n > 1 ? Math.min(1, (D * 0.45) / n) : 0;
  shapes = await Promise.all(S.highlights.map(async (h, i) => {
    const c = S.countries[i];
    const path = new Path2D();
    const rings = [];
    for (const poly of c.polygons) for (const ring of poly) { addRing(path, ring); rings.push(ring); }
    const start = h.start ?? cameraPlan.starts?.[i] ?? D * 0.1 + i * stagger;
    const trace = Math.min(1.6, D * 0.35, cameraPlan.hold ? cameraPlan.hold * 0.5 : Infinity);
    const labelStart = start + trace * 0.75;
    const labelDur = h.labelAnim === 'type' ? Math.max(0.5, (h.label?.length ?? 0) * 0.07) : 0.6;
    return {
      h, c, path, rings, lengths: rings.map(ringLength),
      flag: h.style === 'flag' ? await loadImage(`/flag/${c.iso2}.svg`) : null,
      timing: { start, trace, fillStart: start + trace * 0.45, fillDur: Math.min(1, D * 0.2), labelStart, labelDur, cityStart: labelStart + labelDur * 0.8 },
    };
  }));
}

function buildContext() {
  if (!S.context) return;
  land = new Path2D();
  for (const country of S.context) {
    for (const poly of country.polygons) {
      if (!country.linesOnly) for (const ring of poly) addRing(land, ring);
      borderRings.push(poly[0]);
    }
  }
}

// Seeded noise so every frame gets the same paper grain.
function buildPaperTexture() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tex = new OffscreenCanvas(W, H);
  const t = tex.getContext('2d');
  t.fillStyle = '#ffffff';
  t.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const x = rand() * W, y = rand() * H, r = (0.1 + rand() * 0.35) * Math.max(W, H);
    const g = t.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,110,60,${0.05 + rand() * 0.08})`);
    g.addColorStop(1, 'rgba(150,110,60,0)');
    t.fillStyle = g;
    t.fillRect(0, 0, W, H);
  }
  const img = t.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  t.putImageData(img, 0, 0);
  paperTexture = tex;
}

// ---------- world layers ----------

// `k` is pixels per world unit of the target canvas; line widths are in those pixels.
function drawPaperWorld(c2, k, bounds) {
  c2.fillStyle = PAPER.sea;
  c2.fillRect(bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]);
  if (!land) return;
  c2.lineJoin = 'round';
  // Engraved coastal ripples: wide faint strokes under the land fill only show at sea.
  for (const [w, a] of [[26, 0.08], [16, 0.12], [8, 0.18]]) {
    c2.strokeStyle = `rgba(110,85,50,${a})`;
    c2.lineWidth = w / k;
    c2.stroke(land);
  }
  c2.fillStyle = PAPER.land;
  c2.fill(land, 'evenodd');
  c2.strokeStyle = PAPER.coast;
  c2.lineWidth = 1.3 / k;
  c2.stroke(land);
}

// The world under the current camera is drawn once per frame ('raw'); filtered versions are copies of it.
// Canvases are pooled by filter and reused across frames.
const pool = new Map();
function pooled(key) {
  let l = pool.get(key);
  if (!l) pool.set(key, (l = new OffscreenCanvas(W, H)));
  const c2 = l.getContext('2d');
  c2.setTransform(1, 0, 0, 1, 0, 0);
  c2.filter = 'none';
  c2.clearRect(0, 0, W, H);
  return [l, c2];
}

function layer(filter) {
  if (layers.has(filter)) return layers.get(filter);
  let l, c2;
  if (filter === 'raw') {
    [l, c2] = pooled('raw');
    c2.setTransform(...worldTransform(cam));
    c2.fillStyle = S.basemap.kind === 'paper' ? PAPER.sea : '#06101c';
    c2.fillRect(cam.cx - W / cam.k, cam.cy - H / cam.k, (2 * W) / cam.k, (2 * H) / cam.k);
    for (const lv of levels) c2.drawImage(lv.img, lv.x0, lv.y0, lv.img.width * lv.scale, lv.img.height * lv.scale);
  } else {
    const raw = layer('raw');
    [l, c2] = pooled(filter);
    c2.filter = filter;
    c2.drawImage(raw, 0, 0);
  }
  layers.set(filter, l);
  return l;
}

const baseFilter = () => (S.basemap.kind === 'paper' ? 'raw' : GRADES[S.effects.grade]);

function luminance(color) {
  ctx.save();
  ctx.fillStyle = color; // normalizes any CSS colour to #rrggbb
  const hex = ctx.fillStyle;
  ctx.restore();
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Draw `img` (screen-sized) only inside a highlight's shape.
function drawInside(s, img, alpha = 1, op = 'source-over') {
  ctx.save();
  ctx.setTransform(...worldTransform(cam));
  ctx.clip(s.path, 'evenodd');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// ---------- highlight layers ----------

function drawTint(s, f) {
  const { h } = s;
  // Grey terrain multiplied by the colour keeps mountains and rivers visible through the fill.
  // Light colours (yellow) need a brighter grey underneath or they turn muddy.
  const bright = (1.15 + luminance(h.color) * 0.8).toFixed(2);
  drawInside(s, layer(`grayscale(1) contrast(1.2) brightness(${bright})`), f);
  ctx.save();
  ctx.setTransform(...worldTransform(cam));
  ctx.clip(s.path, 'evenodd');
  ctx.fillStyle = h.color;
  ctx.globalAlpha = f;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fill(s.path, 'evenodd');
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = f * 0.6;
  ctx.fill(s.path, 'evenodd');
  ctx.restore();
}

// The flag stretched over the country, blended so the terrain still reads through the stripes.
function drawFlag(s, f) {
  if (!s.flag) return drawTint(s, f);
  const b = s.c.frameBox;
  ctx.save();
  ctx.setTransform(...worldTransform(cam));
  ctx.clip(s.path, 'evenodd');
  // Multiply keeps the terrain in every stripe (white stripes stay natural land); a light
  // overlay pass then brings the flag colours back up to full strength.
  ctx.globalAlpha = f;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(s.flag, b[0], b[1], b[2] - b[0], b[3] - b[1]);
  ctx.globalAlpha = f * 0.55;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(s.flag, b[0], b[1], b[2] - b[0], b[3] - b[1]);
  ctx.restore();
}

function strokeRings(rings, lengths, p) {
  rings.forEach((ring, i) => {
    const L = lengths ? lengths[i] : 0;
    if (lengths && L * cam.k < 2) return;
    ctx.setLineDash(p >= 1 || !lengths ? [] : [L * p, L]);
    ctx.beginPath();
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let j = 1; j < ring.length; j++) ctx.lineTo(ring[j][0], ring[j][1]);
    if (p >= 1) ctx.closePath();
    ctx.stroke();
  });
}

function drawBorder(s, p) {
  const b = s.h.border;
  if (!b || p <= 0) return;
  ctx.save();
  ctx.setTransform(...worldTransform(cam));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = b.color;
  const passes = b.glow > 0 ? [{ blur: 28 * b.glow, alpha: 0.9, width: b.width * 1.6 }, { blur: 8 * b.glow, alpha: 1, width: b.width }] : [{ blur: 0, alpha: 1, width: b.width }];
  for (const pass of passes) {
    ctx.shadowColor = b.glowColor || b.color;
    ctx.shadowBlur = pass.blur;
    ctx.globalAlpha = pass.alpha;
    ctx.lineWidth = pass.width / cam.k;
    strokeRings(s.rings, s.lengths, p);
  }
  ctx.restore();
}

// A label may have several lines ("SPAIN\n11.4%"); lines after the first are the smaller value line.
const labelLines = (text) => text.split('\n');

function labelSize(s) {
  const lines = labelLines(s.h.label);
  const chars = Math.max(lines[0].length, ...lines.slice(1).map((l) => l.length * 0.75));
  // Caps run about 0.8em wide with our tracking; keep the word inside the country.
  const cap = shapes.length > 1 ? H * 0.06 : H * 0.1;
  const fit = Math.max(shapes.length > 1 ? H * 0.018 : H * 0.025, Math.min(cap, (s.c.labelWidth * cam.k * 0.85) / (chars * 0.82)));
  return fit * s.h.labelSize;
}

// Screen position of the label, moved up or down when it would sit on top of this country's city marker.
function labelPosition(s, size) {
  const [x, y] = toScreen(s.c.labelPoint);
  if (!s.c.city) return [x, y];
  const [cx, cy] = toScreen(s.c.city.point);
  const halfW = (s.c.labelWidth * cam.k) / 2;
  const clear = size * 0.95;
  if (Math.abs(cx - x) > halfW || Math.abs(cy - y) >= clear) return [x, y];
  return [x, cy > y ? cy - clear : cy + clear];
}

function drawLabel(s, p) {
  const { h } = s;
  if (!h.label || p <= 0) return;
  const size = labelSize(s);
  const [x, y] = labelPosition(s, size);
  const e = easeOut(p);
  const full = labelLines(h.label);
  let lines = full;
  let dx = 0, dy = 0, scale = 1, alpha = e, spacing = 0.05;
  if (h.labelAnim === 'rise') dy = (1 - e) * size * 0.35;
  else if (h.labelAnim === 'slide') dx = -(1 - e) * size * 1.5;
  else if (h.labelAnim === 'spread') { spacing = lerp(0.6, 0.05, e); alpha = clamp01(p * 2); }
  else if (h.labelAnim === 'pop') { scale = easeOutBack(clamp01(p)); alpha = clamp01(p * 3); }
  else if (h.labelAnim === 'type') { lines = labelLines(h.label.slice(0, Math.ceil(p * h.label.length))); alpha = 1; }

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, x + dx, y + dy);
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const paper = S.basemap.kind === 'paper';
  ctx.shadowColor = paper ? 'rgba(239,226,194,0.9)' : 'rgba(0,0,0,0.55)';
  ctx.fillStyle = h.labelColor;
  const sizes = full.map((_, i) => (i === 0 ? size : size * 0.75));
  const total = sizes.reduce((a, b) => a + b * 1.1, 0);
  let ly = -total / 2;
  lines.forEach((line, i) => {
    const fs = sizes[i];
    ctx.font = `${i === 0 ? h.labelWeight : 600} ${fs}px ${FONTS[h.labelFont] || h.labelFont}`;
    ctx.letterSpacing = `${fs * spacing}px`;
    ctx.shadowBlur = fs * (paper ? 0.25 : 0.35);
    ly += (fs * 1.1) / 2;
    // Typing grows from the left edge of the finished line so letters don't shift as they appear.
    ctx.fillText(line, -ctx.measureText(full[i]).width / 2, ly);
    ly += (fs * 1.1) / 2;
  });
  ctx.restore();
}

function drawCity(s, t) {
  const city = s.c.city;
  if (!city) return;
  const p = progress(t, s.timing.cityStart, 0.5);
  if (p <= 0) return;
  const [x, y] = toScreen(city.point);
  const paper = S.basemap.kind === 'paper';
  const ink = paper ? PAPER.ink : '#ffffff';
  const base = Math.min(W, H);
  const r = base * 0.007;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Two pulse rings that keep repeating once the dot has landed.
  for (const offset of [0, 0.5]) {
    const q = (((t - s.timing.cityStart) / 1.6 + offset) % 1 + 1) % 1;
    ctx.globalAlpha = (1 - q) * 0.7 * easeOut(p);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + q * r * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = easeOut(p);
  ctx.fillStyle = paper ? '#a3221b' : '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = paper ? 0 : 8;
  ctx.beginPath();
  ctx.arc(x, y, r * easeOutBack(p), 0, Math.PI * 2);
  ctx.fill();
  // Cinzel's small capitals read smaller than Montserrat at the same size, so paper gets a bump.
  ctx.font = `${paper ? 700 : 600} ${base * (paper ? 0.036 : 0.03) * s.h.labelSize}px ${paper ? FONTS.serif : FONTS.sans}`;
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.shadowColor = paper ? 'rgba(239,226,194,0.95)' : 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = paper ? 8 : 6;
  // Keep the name on screen: put it on the left of the dot when the right side would run off the frame.
  const gap = r * 2.2 + (1 - easeOut(p)) * 10;
  const left = x + gap + ctx.measureText(city.name).width > W - base * 0.03;
  ctx.textAlign = left ? 'right' : 'left';
  ctx.fillText(city.name, left ? x - gap : x + gap, y);
  ctx.restore();
}

// ---------- scene-wide effects ----------

function gridStep() {
  if (S.effects.grid.step) return S.effects.grid.step;
  const degreesWide = ((W / cam.k) / 256) * 360;
  return [1, 2, 5, 10, 15, 20, 30].find((s) => degreesWide / s <= 14) ?? 30;
}

const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
};

// Graticule over the sea only: draw lines, then cut the land out of them.
function drawGrid() {
  const g = S.effects.grid;
  const off = new OffscreenCanvas(W, H);
  const c2 = off.getContext('2d');
  c2.setTransform(...worldTransform(cam));
  c2.strokeStyle = g.color;
  c2.lineWidth = 1.2 / cam.k;
  const step = gridStep();
  const x0 = cam.cx - W / 2 / cam.k, x1 = cam.cx + W / 2 / cam.k;
  const y0 = cam.cy - H / 2 / cam.k, y1 = cam.cy + H / 2 / cam.k;
  const lon0 = Math.floor(((x0 / 256) * 360 - 180) / step) * step;
  c2.beginPath();
  for (let lon = lon0; ((lon + 180) / 360) * 256 <= x1; lon += step) {
    const x = ((lon + 180) / 360) * 256;
    c2.moveTo(x, y0); c2.lineTo(x, y1);
  }
  for (let lat = -80; lat <= 80; lat += step) {
    const y = mercY(lat);
    if (y < y0 || y > y1) continue;
    c2.moveTo(x0, y); c2.lineTo(x1, y);
  }
  c2.stroke();
  if (land) {
    c2.globalCompositeOperation = 'destination-out';
    c2.fill(land, 'evenodd');
    c2.lineWidth = 3 / cam.k;
    c2.stroke(land);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = g.opacity;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

function drawNeighbourBorders() {
  ctx.save();
  ctx.setTransform(...worldTransform(cam));
  const paper = S.basemap.kind === 'paper';
  ctx.strokeStyle = paper ? 'rgba(74,56,38,0.55)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = (paper ? 1.2 : 1) / cam.k;
  ctx.lineJoin = 'round';
  if (paper) ctx.setLineDash([5 / cam.k, 3 / cam.k]);
  strokeRings(borderRings, null, 1);
  ctx.restore();
}

function formatNumber(v) {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits)).toLocaleString('en-US');
}

function drawLegend(t) {
  const L = S.legend;
  if (!L) return;
  const a = easeOut(progress(t, 0.3, 0.6));
  if (a <= 0) return;
  const paper = S.basemap.kind === 'paper';
  const u = H / 1080;
  const barW = 360 * u, barH = 16 * u, pad = 22 * u;
  const titleSize = 24 * u, numSize = 18 * u;
  const boxW = barW + pad * 2;
  const boxH = pad * 2 + (L.title ? titleSize + 14 * u : 0) + barH + numSize + 10 * u;
  const x = 48 * u, y = H - 48 * u - boxH;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = a;
  ctx.fillStyle = paper ? 'rgba(239,226,194,0.85)' : 'rgba(5,12,24,0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 12 * u);
  ctx.fill();
  const ink = paper ? PAPER.ink : '#ffffff';
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  let cy = y + pad;
  if (L.title) {
    ctx.font = `700 ${titleSize}px ${paper ? FONTS.serif : FONTS.sans}`;
    ctx.fillText(L.title, x + pad, cy);
    cy += titleSize + 14 * u;
  }
  const g = ctx.createLinearGradient(x + pad, 0, x + pad + barW, 0);
  L.stops.forEach((c, i) => g.addColorStop(i / (L.stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x + pad, cy, barW, barH);
  cy += barH + 8 * u;
  ctx.fillStyle = ink;
  ctx.font = `500 ${numSize}px ${FONTS.sans}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${L.prefix}${formatNumber(L.min)}${L.unit}`, x + pad, cy);
  ctx.textAlign = 'right';
  ctx.fillText(`${L.prefix}${formatNumber(L.max)}${L.unit}`, x + pad + barW, cy);
  ctx.restore();
}

// Soft focus toward the edges, like a shallow-depth-of-field camera move over a printed map.
function drawLensBlur(v) {
  const off = new OffscreenCanvas(W, H);
  const c2 = off.getContext('2d');
  c2.filter = `blur(${(v * 14 * H) / 1080}px)`;
  c2.drawImage(canvas, 0, 0);
  c2.filter = 'none';
  c2.globalCompositeOperation = 'destination-in';
  const g = c2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c2.fillStyle = g;
  c2.fillRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0);
}

function drawVignette(v) {
  if (!v) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  const tone = S.basemap.kind === 'paper' ? '60,40,15' : '0,0,0';
  g.addColorStop(0, `rgba(${tone},0)`);
  g.addColorStop(1, `rgba(${tone},${v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------- globe ----------

const GLOBE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes, uCenter;
uniform float uR, uLod;
uniform mat3 uRot;
uniform sampler2D uTex;
out vec4 outColor;
const float PI = 3.14159265;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 v = (px - uCenter) / uR;
  float r = length(v);
  if (r > 1.0) { outColor = vec4(0.0); return; }
  float z = sqrt(1.0 - r * r);
  vec3 w = uRot * vec3(v.x, -v.y, z);
  float lat = clamp(asin(clamp(w.y, -1.0, 1.0)), -1.4844, 1.4844); // Web Mercator stops at 85 degrees
  float lon = atan(w.x, w.z);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - log(tan(PI / 4.0 + lat / 2.0)) / (2.0 * PI));
  vec3 c = textureLod(uTex, uv, uLod).rgb;
  float shade = 0.3 + 0.7 * pow(z, 0.55); // darker towards the limb
  float edge = smoothstep(1.0, 1.0 - 2.0 / uR, r);
  outColor = vec4(c * shade * edge, edge);
}`;

let globeGL = null; // { canvas, gl, uniforms }
let stars = null;

async function buildGlobe3D() {
  if (!cameraPlan.globe) return;
  const n = 2 ** GLOBE_ZOOM;
  const world = new OffscreenCanvas(n * 256, n * 256);
  const wctx = world.getContext('2d');
  const jobs = [];
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      jobs.push(loadImage(`/tile/${S.basemap.name}/${GLOBE_ZOOM}/${tx}/${ty}.jpg`).then((img) => {
        if (img) wctx.drawImage(img, tx * 256, ty * 256);
        else missing++;
      }));
    }
  }
  await Promise.all(jobs);

  const glCanvas = new OffscreenCanvas(W, H);
  const gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available in this browser, so the globe camera cannot run');
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, GLOBE_FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, world);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const u = (name) => gl.getUniformLocation(prog, name);
  globeGL = { canvas: glCanvas, gl, uniforms: { res: u('uRes'), center: u('uCenter'), r: u('uR'), lod: u('uLod'), rot: u('uRot') }, texSize: n * 256 };

  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  stars = new OffscreenCanvas(W, H);
  const sctx = stars.getContext('2d');
  sctx.fillStyle = '#01030a';
  sctx.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 2600; i++) {
    sctx.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.75})`;
    const r = rand() < 0.93 ? 0.6 : 1.3;
    sctx.beginPath();
    sctx.arc(rand() * W, rand() * H, r, 0, Math.PI * 2);
    sctx.fill();
  }
}

// Column-major rotation taking view space (x right, y up, z towards the viewer) to the globe at lat/lon.
function globeRotation(latDeg, lonDeg) {
  const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  // Ry(lon) * Rx(-lat), written out row by row, then transposed for GLSL.
  const m = [
    [co, -so * sl, so * cl],
    [0, cl, sl],
    [-so, -co * sl, co * cl],
  ];
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}

function drawGlobe(g) {
  const { gl, uniforms, canvas: glCanvas, texSize } = globeGL;
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uniforms.res, W, H);
  gl.uniform2f(uniforms.center, W / 2, H / 2);
  gl.uniform1f(uniforms.r, g.r);
  gl.uniform1f(uniforms.lod, Math.max(0, Math.log2(texSize / (Math.PI * g.r))));
  gl.uniformMatrix3fv(uniforms.rot, false, globeRotation(g.lat, g.lon));
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const [space, sctx] = pooled('globe');
  sctx.drawImage(stars, 0, 0);
  // Atmosphere: a soft blue halo just outside the limb, fading out as the globe fills the frame.
  const halo = clamp01(1.6 - g.r / Math.max(W, H));
  if (halo > 0) {
    const atm = sctx.createRadialGradient(W / 2, H / 2, g.r * 0.96, W / 2, H / 2, g.r * 1.16);
    atm.addColorStop(0, `rgba(120,180,255,${0.55 * halo})`);
    atm.addColorStop(0.35, `rgba(70,130,255,${0.25 * halo})`);
    atm.addColorStop(1, 'rgba(40,90,255,0)');
    sctx.fillStyle = atm;
    sctx.fillRect(0, 0, W, H);
  }
  sctx.drawImage(glCanvas, 0, 0);
  // Hand-off: globe and flat map agree at the centre but not at the edges of a wide view, so the flat
  // map is revealed from the centre outwards instead of cross-fading everywhere at once.
  if (g.alpha < 1) {
    const a = 1 - g.alpha;
    const reach = Math.hypot(W, H) / 2;
    const mask = sctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, reach);
    mask.addColorStop(0, `rgba(0,0,0,${clamp01(1 - a * 2.2)})`);
    mask.addColorStop(clamp01(a * 1.3 - 0.3) || 0.0001, `rgba(0,0,0,${clamp01(1.4 - a * 1.6)})`);
    mask.addColorStop(1, `rgba(0,0,0,${clamp01(1.6 - a * 1.6)})`);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.fillStyle = mask;
    sctx.fillRect(0, 0, W, H);
    sctx.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(space, 0, 0);
  ctx.restore();
}

// ---------- frame ----------

function draw(t) {
  cam = camera(t);
  layers = new Map();
  const g = cameraPlan.globe?.at(t);
  if (g && g.alpha >= 1) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawGlobe(g);
    drawVignette(S.effects.vignette);
    return;
  }
  drawFlat(t);
  if (g && g.alpha > 0) drawGlobe(g);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (paperTexture) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(paperTexture, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  drawVignette(S.effects.vignette);
}

function drawFlat(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#06101c';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(layer(baseFilter()), 0, 0);

  // "highlight" style drains colour from everything outside the countries as they fill in.
  const spot = shapes.filter((s) => s.h.style === 'highlight');
  const spotP = spot.length ? Math.max(...spot.map((s) => easeInOut(progress(t, s.timing.fillStart, s.timing.fillDur)))) : 0;
  if (spotP > 0) {
    ctx.globalAlpha = spotP;
    ctx.drawImage(layer(GRADES.mono), 0, 0);
    ctx.globalAlpha = 1;
    for (const s of spot) drawInside(s, layer(baseFilter()));
  }

  if (S.effects.grid) drawGrid();
  if (S.effects.borders && land) drawNeighbourBorders();

  for (const s of shapes) {
    const f = easeInOut(progress(t, s.timing.fillStart, s.timing.fillDur)) * s.h.opacity;
    if (f <= 0 || s.h.style === 'outline') continue;
    if (s.h.style === 'flag') drawFlag(s, f);
    else drawTint(s, f);
  }
  for (const s of shapes) drawBorder(s, easeInOut(progress(t, s.timing.start, s.timing.trace)));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (S.effects.blur > 0) drawLensBlur(S.effects.blur);
  for (const s of shapes) drawLabel(s, progress(t, s.timing.labelStart, s.timing.labelDur));
  for (const s of shapes) drawCity(s, t);
  drawLegend(t);
}

window.mapcast = {
  async init(payload) {
    S = payload;
    W = canvas.width = S.width;
    H = canvas.height = S.height;
    camera = buildCamera();
    buildContext();
    if (S.basemap.kind === 'paper') buildPaperTexture();
    await Promise.all([
      buildShapes(),
      buildMosaics(),
      buildGlobe3D(),
      document.fonts.load('700 40px Montserrat'),
      document.fonts.load('700 40px Cinzel'),
    ]);
    const noFlag = shapes.filter((s) => s.h.style === 'flag' && !s.flag).map((s) => s.c.name);
    return { missing, noFlag, levels: levels.map((l) => ({ z: l.z, w: l.img.width, h: l.img.height })) };
  },
  draw,
  // Downscaled JPEG of the current frame, base64, for agents to look at.
  async preview(width) {
    const h = Math.round((H * width) / W);
    const off = new OffscreenCanvas(width, h);
    off.getContext('2d').drawImage(canvas, 0, 0, width, h);
    const bytes = new Uint8Array(await (await off.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};
window.mapcastReady = true;
