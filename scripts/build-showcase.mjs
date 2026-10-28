// Builds docs/showcase.gif (README hero) and docs/gallery.jpg from a few scenes. Run: npm run showcase
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '../src/render.js';

const W = 960, H = 540;
const DOCS = new URL('../docs/', import.meta.url).pathname;
const TMP = join(tmpdir(), `mapcast-showcase-${process.pid}`);

// [name, scene, seconds of the clip kept in the GIF (from the start)]
const CLIPS = [
  ['globe', { camera: 'globe', duration: 5.2, highlights: [{ country: 'India' }] }, 5.2],
  ['flag', { duration: 3.2, effects: { grid: true, blur: 0.7, grade: 'muted' }, highlights: [{ country: 'France', style: 'flag', labelAnim: 'spread' }] }, 3.2],
  ['paper', { basemap: 'paper', duration: 3.2, highlights: [{ country: 'Italy', capital: true, labelAnim: 'type' }] }, 3.2],
  ['data', {
    camera: 'static', duration: 3.2,
    data: { title: 'Unemployment rate, 2024', unit: '%', scheme: 'reds', labels: 'both', values: { Spain: 11.4, Greece: 9.8, Italy: 6.5, France: 7.4, Germany: 3.4, Poland: 2.9 } },
  }, 3.2],
  ['fly', { camera: 'fly', duration: 5, highlights: [{ country: 'Egypt' }, { country: 'Turkey' }] }, 5],
];

const ffmpeg = (args) => {
  const r = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};

await mkdir(TMP, { recursive: true });
await mkdir(DOCS, { recursive: true });
const parts = [];
for (const [name, scene, keep] of CLIPS) {
  const out = join(TMP, `${name}.mp4`);
  console.log(`rendering ${name}...`);
  await render({ ...scene, width: W, height: H, fps: 24 }, out);
  await render({ ...scene, width: W, height: H }, join(TMP, `${name}.jpg`));
  parts.push({ out, keep });
}

// Join the clips, then make a palette-optimised GIF. Satellite imagery is noisy and GIF compresses it
// badly, so the GIF is small (560 px, 10 fps, ordered dither) to stay well under GitHub's 10 MB image limit;
// docs/showcase.mp4 is the full-quality version.
const list = join(TMP, 'list.txt');
await writeFile(list, parts.map((p) => `file '${p.out}'\noutpoint ${p.keep}`).join('\n'));
const joined = join(TMP, 'joined.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', joined]);
ffmpeg(['-i', joined, '-vf', 'fps=10,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', join(DOCS, 'showcase.gif')]);
ffmpeg(['-i', joined, '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(DOCS, 'showcase.mp4')]);

// Gallery: final frames in a 3x2 grid (the sixth tile is the globe mid-dive).
await render({ ...CLIPS[0][1], width: W, height: H }, join(TMP, 'globe-mid.jpg'), { at: 1.6 });
const tiles = ['globe-mid', 'globe', 'flag', 'paper', 'data', 'fly'].map((n) => join(TMP, `${n}.jpg`));
ffmpeg([...tiles.flatMap((t) => ['-i', t]), '-filter_complex', '[0][1][2]hstack=3[t];[3][4][5]hstack=3[b];[t][b]vstack,scale=1440:-1', '-q:v', '4', join(DOCS, 'gallery.jpg')]);

await rm(TMP, { recursive: true, force: true });
console.log(`wrote ${DOCS}showcase.gif, showcase.mp4 and gallery.jpg`);
