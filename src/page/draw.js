// Runs inside headless Chromium. Node calls mapcast.init(payload) once, then mapcast.draw(t) per frame.
// Coordinates are Web Mercator pixels at zoom 0 (the whole world is 256 units wide).

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const progress = (t, start, dur) => clamp01((t - start) / dur);

let S; // normalized scene
let W, H;
let levels = []; // [{ z, x0, y0, img }] mosaics, coarse to fine
let shapes = []; // per highlight: { path, rings, lengths, labelPoint, labelWidth, timing }
let camera;
let missing = 0;

function buildCamera() {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of S.countries) {
    box[0] = Math.min(box[0], c.frameBox[0]); box[1] = Math.min(box[1], c.frameBox[1]);
    box[2] = Math.max(box[2], c.frameBox[2]); box[3] = Math.max(box[3], c.frameBox[3]);
  }
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const fill = S.camera.fill;
  const kFit = Math.min((W * fill) / Math.max(box[2] - box[0], 1e-6), (H * fill) / Math.max(box[3] - box[1], 1e-6));
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
  };
  return moves[S.camera.move];
}

// Load the tile pyramid the camera path needs: one mosaic per zoom level, each only as large as
// the view is while that level is the sharpest needed one.
async function loadTiles() {
  const samples = Array.from({ length: 61 }, (_, i) => camera((S.duration * i) / 60));
  const ks = samples.map((s) => s.k);
  const zFor = (k) => Math.max(0, Math.min(S.basemap.maxZoom, Math.ceil(Math.log2(k * S.basemap.sharpness))));
  const zMin = zFor(Math.min(...ks));
  const zMax = zFor(Math.max(...ks));
  const jobs = [];
  for (let z = zMin; z <= zMax; z++) {
    const view = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of samples) {
      if (z > zMin && zFor(s.k) < z) continue;
      const hw = W / 2 / s.k;
      const hh = H / 2 / s.k;
      view[0] = Math.min(view[0], s.cx - hw); view[1] = Math.min(view[1], s.cy - hh);
      view[2] = Math.max(view[2], s.cx + hw); view[3] = Math.max(view[3], s.cy + hh);
    }
    const n = 2 ** z;
    const unit = n; // tile pixels per zoom-0 unit
    const tx0 = Math.floor((view[0] * unit) / 256);
    const ty0 = Math.max(0, Math.floor((view[1] * unit) / 256));
    const tx1 = Math.floor((view[2] * unit) / 256);
    const ty1 = Math.min(n - 1, Math.floor((view[3] * unit) / 256));
    const mosaic = new OffscreenCanvas((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256);
    const mctx = mosaic.getContext('2d');
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        jobs.push(loadImage(`/tile/${S.basemap.name}/${z}/${tx}/${ty}.jpg`).then((img) => {
          if (img) mctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256);
          else missing++;
        }));
      }
    }
    levels.push({ z, x0: (tx0 * 256) / unit, y0: (ty0 * 256) / unit, scale: 1 / unit, img: mosaic });
  }
  await Promise.all(jobs);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function ringLength(ring) {
  let len = 0;
  for (let i = 1; i < ring.length; i++) len += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return len;
}

function buildShapes() {
  const n = S.highlights.length;
  const D = S.duration;
  const stagger = n > 1 ? Math.min(1, (D * 0.45) / n) : 0;
  shapes = S.highlights.map((h, i) => {
    const c = S.countries[i];
    const path = new Path2D();
    const rings = [];
    for (const poly of c.polygons) {
      for (const ring of poly) {
        path.moveTo(ring[0][0], ring[0][1]);
        for (let j = 1; j < ring.length; j++) path.lineTo(ring[j][0], ring[j][1]);
        path.closePath();
        rings.push(ring);
      }
    }
    const start = h.start ?? D * 0.1 + i * stagger;
    const trace = Math.min(1.6, D * 0.35);
    return {
      h, path, rings, lengths: rings.map(ringLength), labelPoint: c.labelPoint, labelWidth: c.labelWidth,
      timing: { start, trace, fillStart: start + trace * 0.45, fillDur: Math.min(1, D * 0.2), labelStart: start + trace * 0.75, labelDur: 0.6 },
    };
  });
}

function drawBase(filter) {
  ctx.filter = filter;
  for (const l of levels) ctx.drawImage(l.img, l.x0, l.y0, l.img.width * l.scale, l.img.height * l.scale);
  ctx.filter = 'none';
}

const GRADES = {
  natural: 'saturate(1.08) contrast(1.05) brightness(0.92)',
  muted: 'saturate(0.6) contrast(1.05) brightness(0.75)',
  mono: 'grayscale(1) contrast(1.15) brightness(0.55)',
};

function luminance(color) {
  ctx.save();
  ctx.fillStyle = color; // normalizes any CSS colour to #rrggbb
  const hex = ctx.fillStyle;
  ctx.restore();
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function drawTint(s, cam, f) {
  const { h } = s;
  ctx.save();
  ctx.clip(s.path, 'evenodd');
  ctx.globalAlpha = f;
  // Grey terrain multiplied by the colour keeps mountains and rivers visible through the fill.
  // Light colours (yellow) need a brighter grey underneath or they turn muddy.
  drawBase(`grayscale(1) contrast(1.2) brightness(${(1.15 + luminance(h.color) * 0.8).toFixed(2)})`);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = h.color;
  ctx.fill(s.path, 'evenodd');
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = f * 0.6;
  ctx.fill(s.path, 'evenodd');
  ctx.restore();
}

function drawBorder(s, cam, p) {
  const b = s.h.border;
  if (!b || p <= 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = b.color;
  const passes = b.glow > 0 ? [{ blur: 28 * b.glow, alpha: 0.9, width: b.width * 1.6 }, { blur: 8 * b.glow, alpha: 1, width: b.width }] : [{ blur: 0, alpha: 1, width: b.width }];
  for (const pass of passes) {
    ctx.shadowColor = b.glowColor || b.color;
    ctx.shadowBlur = pass.blur;
    ctx.globalAlpha = pass.alpha;
    ctx.lineWidth = pass.width / cam.k;
    s.rings.forEach((ring, i) => {
      const L = s.lengths[i];
      if (L * cam.k < 2) return;
      ctx.setLineDash(p >= 1 ? [] : [L * p, L]);
      ctx.beginPath();
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let j = 1; j < ring.length; j++) ctx.lineTo(ring[j][0], ring[j][1]);
      if (p >= 1) ctx.closePath();
      ctx.stroke();
    });
  }
  ctx.restore();
}

function drawLabel(s, cam, p) {
  const { h } = s;
  if (!h.label || p <= 0) return;
  const x = W / 2 + (s.labelPoint[0] - cam.cx) * cam.k;
  const y = H / 2 + (s.labelPoint[1] - cam.cy) * cam.k;
  const chars = h.label.length;
  // Montserrat caps run about 0.8em wide with our tracking; keep the word inside the country.
  const cap = shapes.length > 1 ? H * 0.06 : H * 0.1;
  const size = Math.max(H * 0.025, Math.min(cap, (s.labelWidth * cam.k * 0.85) / (chars * 0.82)));
  const e = easeOut(p);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = e;
  ctx.font = `${h.labelWeight} ${size}px Montserrat`;
  ctx.letterSpacing = `${size * 0.05}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = h.labelColor;
  ctx.fillText(h.label, x, y + (1 - e) * size * 0.35);
  ctx.restore();
}

function drawVignette(v) {
  if (!v) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${v})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function draw(t) {
  const cam = camera(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06101c';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.k, 0, 0, cam.k, W / 2 - cam.cx * cam.k, H / 2 - cam.cy * cam.k);

  // "highlight" style drains colour from everything outside the countries as they fill in.
  const spot = shapes.filter((s) => s.h.style === 'highlight');
  const spotP = spot.length ? Math.max(...spot.map((s) => easeInOut(progress(t, s.timing.fillStart, s.timing.fillDur)))) : 0;
  drawBase(GRADES[S.effects.grade]);
  if (spotP > 0) {
    ctx.globalAlpha = spotP;
    drawBase(GRADES.mono);
    ctx.globalAlpha = 1;
    for (const s of spot) {
      ctx.save();
      ctx.clip(s.path, 'evenodd');
      drawBase(GRADES[S.effects.grade]);
      ctx.restore();
    }
  }

  for (const s of shapes) {
    const f = easeInOut(progress(t, s.timing.fillStart, s.timing.fillDur)) * s.h.opacity;
    if (s.h.style !== 'outline' && f > 0) drawTint(s, cam, f);
  }
  for (const s of shapes) drawBorder(s, cam, easeInOut(progress(t, s.timing.start, s.timing.trace)));
  for (const s of shapes) drawLabel(s, cam, progress(t, s.timing.labelStart, s.timing.labelDur));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawVignette(S.effects.vignette);
}

window.mapcast = {
  async init(payload) {
    S = payload;
    W = canvas.width = S.width;
    H = canvas.height = S.height;
    camera = buildCamera();
    buildShapes();
    await Promise.all([loadTiles(), document.fonts.load('800 40px Montserrat')]);
    return { missing, levels: levels.map((l) => ({ z: l.z, w: l.img.width, h: l.img.height })) };
  },
  draw,
};
window.mapcastReady = true;
