import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CACHE_DIR = process.env.MAPCAST_CACHE || join(homedir(), '.cache', 'mapcast');

// Free tile servers throttle bursts, so keep a few downloads in flight and retry with backoff.
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting = [];

async function limited(fn) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function download(url) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'mapcast (open-source map animation tool)' } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = new Error(`Download failed (${res.status}): ${url}`);
      if (res.status === 404) break;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Fetch a URL once and keep it on disk; later calls read the local copy.
export async function cachedFetch(url, relPath) {
  const file = join(CACHE_DIR, relPath);
  if (existsSync(file)) return readFile(file);
  const buf = await limited(() => download(url));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  return buf;
}
