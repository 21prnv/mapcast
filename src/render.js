import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { normalizeScene } from './scene.js';
import { resolveCountries, prepareCountry } from './geo.js';
import { attribution, fetchTile, getBasemap } from './tiles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://mapcast.local';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.jpg': 'image/jpeg' };

export async function prepare(sceneInput) {
  const scene = normalizeScene(sceneInput);
  const features = await resolveCountries(scene.highlights.map((h) => h.country), scene.pov);
  const countries = features.map(prepareCountry);
  scene.highlights.forEach((h, i) => { h.label ??= countries[i].name.toUpperCase(); });
  const b = getBasemap(scene.basemap);
  return {
    ...scene,
    basemap: { name: scene.basemap, maxZoom: b.maxZoom, sharpness: 1.0 },
    countries,
  };
}

async function openPage(payload) {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const page = await browser.newPage({ viewport: { width: payload.width, height: payload.height }, deviceScaleFactor: 1 });
  await page.route(`${ORIGIN}/**`, async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === '/') path = '/index.html';
    try {
      const tile = path.match(/^\/tile\/([\w-]+)\/(\d+)\/(-?\d+)\/(\d+)\.jpg$/);
      let body;
      if (tile) body = await fetchTile(tile[1], +tile[2], +tile[3], +tile[4]);
      else if (path.startsWith('/font/')) body = await readFile(join(ROOT, 'assets/fonts', path.slice(6)));
      else body = await readFile(join(ROOT, 'src/page', path));
      if (!body) return route.fulfill({ status: 404 });
      await route.fulfill({ body, contentType: TYPES[extname(path)] || 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.mapcastReady);
  const info = await page.evaluate((p) => window.mapcast.init(p), payload);
  if (info.missing) console.warn(`warning: ${info.missing} map tiles could not be downloaded; those areas will look blurry`);
  payload.attribution = attribution(payload.basemap.name, info.levels.map((l) => l.z));
  return { browser, page };
}

async function frame(page, t) {
  await page.evaluate((time) => window.mapcast.draw(time), t);
  return page.screenshot({ type: 'png' });
}

function ffmpeg(args) {
  const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    proc.on('error', () => reject(new Error('ffmpeg not found. Install it (brew install ffmpeg / apt install ffmpeg) or set FFMPEG_PATH.')));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed:\n${err}`))));
  });
  return { proc, done };
}

// Render a scene to .mp4, .png/.jpg (a still, default the final frame) or .gif.
export async function render(sceneInput, out, { at, onProgress } = {}) {
  const payload = await prepare(sceneInput);
  const { browser, page } = await openPage(payload);
  try {
    const ext = extname(out).toLowerCase();
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      await page.evaluate((time) => window.mapcast.draw(time), at ?? payload.duration);
      await page.screenshot({ path: out, type: ext === '.png' ? 'png' : 'jpeg', quality: ext === '.png' ? undefined : 92 });
      return { out, attribution: payload.attribution };
    }
    const codec = ext === '.gif'
      ? ['-vf', 'fps=15,scale=iw/2:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse']
      : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart'];
    const { proc, done } = ffmpeg(['-y', '-f', 'image2pipe', '-framerate', String(payload.fps), '-i', '-', ...codec, out]);
    const total = Math.round(payload.duration * payload.fps);
    for (let i = 0; i < total; i++) {
      const buf = await frame(page, i / payload.fps);
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once('drain', r));
      onProgress?.(i + 1, total);
    }
    proc.stdin.end();
    await done;
    return { out, attribution: payload.attribution };
  } finally {
    await browser.close();
  }
}
