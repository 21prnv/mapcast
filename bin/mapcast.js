#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { render } from '../src/render.js';

const HELP = `mapcast: animated map videos and images from a JSON scene

Usage
  mapcast render <scene.json|-> -o <out.mp4|out.png|out.gif> [--at <seconds>]
  mapcast quick <country> [more countries...] -o <out> [--style solid|highlight|outline] [--color red] [--camera push-in|zoom-in|static] [--aspect 16:9|9:16|1:1|4:5]

Examples
  mapcast quick India -o india.mp4
  mapcast quick "United States" --style highlight --color yellow -o usa.png
  mapcast render examples/india.json -o india.mp4
`;

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else opts._.push(a);
  }
  return opts;
}

async function readScene(src) {
  if (src === '-') {
    let s = '';
    for await (const chunk of process.stdin) s += chunk;
    return JSON.parse(s);
  }
  return JSON.parse(await readFile(src, 'utf8'));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parse(rest);
  if (!cmd || cmd === 'help' || cmd === '--help' || !opts.out) {
    console.log(HELP);
    process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
  }
  let scene;
  if (cmd === 'render') scene = await readScene(opts._[0]);
  else if (cmd === 'quick') {
    scene = {
      highlights: opts._.map((country) => ({ country, style: opts.style, color: opts.color })),
      camera: opts.camera, aspect: opts.aspect, duration: opts.duration ? +opts.duration : undefined,
    };
  } else {
    console.error(`Unknown command "${cmd}".\n\n${HELP}`);
    process.exit(1);
  }
  const started = Date.now();
  const res = await render(scene, opts.out, {
    at: opts.at != null ? +opts.at : undefined,
    onProgress: (i, n) => process.stderr.isTTY && process.stderr.write(`\rrendering frame ${i}/${n}`),
  });
  if (process.stderr.isTTY) process.stderr.write('\n');
  console.log(`wrote ${res.out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`credit: ${res.attribution}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
