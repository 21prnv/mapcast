import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { normalizeScene } from './scene.js';
import { contextCountries, findCity, prepareCountry, project, resolveCountries } from './geo.js';
import { cachedFetch } from './cache.js';
import { attribution, fetchTile, getBasemap } from './tiles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://mapcast.local';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
// Flag artwork from flag-icons (MIT); the flag designs themselves are public domain.
const FLAGS = 'https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3';

// flag-icons SVGs only carry a viewBox; give them a large intrinsic size so they rasterize crisply.
function sizedSvg(buf) {
  return Buffer.from(buf.toString('utf8').replace('<svg ', '<svg width="2560" height="1920" preserveAspectRatio="none" '));
}

export async function prepare(sceneInput) {
  const scene = normalizeScene(sceneInput);
  const { all, matched } = await resolveCountries(scene.highlights.map((h) => h.country), scene.pov);
  const countries = matched.map(prepareCountry);

  for (const [i, h] of scene.highlights.entries()) {
    const c = countries[i];
    h.label ??= c.name.toUpperCase();
    if (h.style === 'flag' && !c.iso2) {
      console.warn(`warning: no flag code for ${c.name}; using a solid fill`);
      h.style = 'solid';
    }
    if (h.capital) {
      const city = await findCity(c.code, h.capital);
      if (!city) console.warn(`warning: could not find ${h.capital === true ? 'a capital' : `"${h.capital}"`} in ${c.name}`);
      else {
        const [lon, lat] = city.lonlat;
        c.city = { name: city.name, point: project([lon + 360 * Math.round((c.centerLon - lon) / 360), lat]) };
      }
    }
  }

  // Neighbouring land is needed for the sea grid, paper maps and neighbour borders.
  let context = null;
  if (scene.effects.grid || scene.effects.borders || scene.basemap === 'paper') {
    const box = countries.reduce((b, c) => [Math.min(b[0], c.frameBox[0]), Math.min(b[1], c.frameBox[1]), Math.max(b[2], c.frameBox[2]), Math.max(b[3], c.frameBox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const span = Math.max(box[2] - box[0], box[3] - box[1]);
    const aspect = Math.max(scene.width / scene.height, scene.height / scene.width);
    const reach = span * (aspect / scene.camera.fill) * (scene.camera.move === 'zoom-in' ? 1 / scene.camera.from : 1.3);
    context = contextCountries(all, [box[0] - reach, box[1] - reach, box[2] + reach, box[3] + reach], countries[0].centerLon, span / 1500);
  }

  const basemap = scene.basemap === 'paper'
    ? { name: 'paper', kind: 'paper' }
    : { name: scene.basemap, kind: 'tiles', maxZoom: getBasemap(scene.basemap).maxZoom, sharpness: 1.0 };
  return { ...scene, basemap, countries, context };
}

export async function openPage(payload) {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  const page = await browser.newPage({ viewport: { width: payload.width, height: payload.height }, deviceScaleFactor: 1 });
  await page.route(`${ORIGIN}/**`, async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === '/') path = '/index.html';
    try {
      const tile = path.match(/^\/tile\/([\w-]+)\/(\d+)\/(-?\d+)\/(\d+)\.jpg$/);
      let body;
      const flag = path.match(/^\/flag\/([a-z]{2})\.svg$/);
      if (tile) body = await fetchTile(tile[1], +tile[2], +tile[3], +tile[4]);
      else if (flag) body = sizedSvg(await cachedFetch(`${FLAGS}/${flag[1]}.svg`, `flags/${flag[1]}.svg`));
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
  payload.attribution = payload.basemap.kind === 'paper'
    ? 'Borders: Natural Earth (public domain)'
    : attribution(payload.basemap.name, info.levels.map((l) => l.z));
  return { browser, page };
}

async function frame(page, t) {
  await page.evaluate((time) => window.mapcast.draw(time), t);
  // JPEG capture is ~8x faster than PNG; at quality 95 it is visually lossless before the H.264 encode.
  return page.screenshot({ type: 'jpeg', quality: 95 });
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
    const { proc, done } = ffmpeg(['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(payload.fps), '-i', '-', ...codec, out]);
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
