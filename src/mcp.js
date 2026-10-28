// MCP server: lets any MCP client (Claude Code, Claude Desktop, Cursor, ...) render maps.
// Runs over stdio; stdout carries the protocol, so diagnostics go to stderr only.
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FORMATS, render } from './render.js';
import { sceneSchema } from './schema.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const GUIDE = `Highlights countries on real satellite imagery (or an old paper map) with a tracing border, colour fill, glow and label, the look of documentary/explainer YouTube videos.
Write a scene: { "highlights": [{ "country": "India" }] } is a complete one. Add only what the request asks for; defaults look good.
Map requests to fields: a colour -> highlights[].color; "show the flag" -> style "flag"; "rest of the world grey/dark" -> style "highlight"; "just the border" -> style "outline"; "old map / history / parchment" -> basemap "paper"; "zoom in from space/far away" -> camera "zoom-in"; "Shorts/Reels/TikTok/vertical" -> aspect "9:16"; "mark the capital" -> capital true; "compare countries by <number>" -> data.values with a title.
Borders follow the highlighted country's official view of disputed areas (pov "auto").`;

const tools = [
  {
    name: 'render_map',
    description: `Render an animated map video (.mp4, .gif) or image (.png, .jpg) and save it to disk. Returns the file path, the imagery credit line (must be shown wherever the video is published) and a small preview of the final frame.\n\n${GUIDE}\n\nA 5 second 1080p video takes roughly 10-30 seconds. Use preview_map first when unsure how a scene will look.`,
    inputSchema: {
      type: 'object',
      required: ['scene'],
      additionalProperties: false,
      properties: {
        scene: sceneSchema,
        output: { type: 'string', description: `Where to save it; the extension picks the format (${FORMATS.join(', ')}). Relative paths resolve against the server's working directory. Default: mapcast-output/map-<time>.mp4.` },
        at: { type: 'number', description: 'Stills only: the second to capture. Default: the final frame.' },
      },
    },
  },
  {
    name: 'preview_map',
    description: `Quickly render one frame of a scene and return it as an image, without making a video. Use it to check framing, colours and labels before render_map.\n\n${GUIDE}`,
    inputSchema: {
      type: 'object',
      required: ['scene'],
      additionalProperties: false,
      properties: {
        scene: sceneSchema,
        at: { type: 'number', description: 'Second to show. Default: the final frame (everything visible).' },
      },
    },
  },
];

// One render at a time: each opens its own browser and a burst would fight over tiles and CPU.
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function callTool(name, args, extra) {
  const token = extra?._meta?.progressToken;
  const onProgress = token == null ? undefined : (progress, total) => {
    if (progress % 15 && progress !== total) return;
    extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total } }).catch(() => {});
  };

  if (name === 'preview_map') {
    const file = join(tmpdir(), `mapcast-preview-${process.pid}-${Date.now()}.jpg`);
    const res = await serial(() => render(args.scene, file, { at: args.at, previewWidth: 1280 }));
    return {
      content: [
        { type: 'image', data: res.preview, mimeType: 'image/jpeg' },
        { type: 'text', text: `Preview at ${args.at ?? res.duration}s of a ${res.width}x${res.height}, ${res.duration}s scene. Full-size still: ${file}` },
      ],
    };
  }

  if (name === 'render_map') {
    const out = resolve(args.output ?? join('mapcast-output', `map-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`));
    const started = Date.now();
    const res = await serial(() => render(args.scene, out, { at: args.at, onProgress, previewWidth: 960 }));
    return {
      content: [
        { type: 'text', text: `Saved ${res.out} (${res.width}x${res.height}, ${res.duration}s) in ${((Date.now() - started) / 1000).toFixed(1)}s.\nCredit to show with it: ${res.attribution}` },
        { type: 'image', data: res.preview, mimeType: 'image/jpeg' },
      ],
    };
  }

  throw new Error(`Unknown tool "${name}"`);
}

export async function startMcpServer() {
  const server = new Server({ name: 'mapcast', version: pkg.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    try {
      return await callTool(req.params.name, req.params.arguments ?? {}, { ...extra, _meta: req.params._meta });
    } catch (e) {
      // Scene errors are written for the agent to fix and retry, so pass them through as tool errors.
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  });
  await server.connect(new StdioServerTransport());
  console.error(`mapcast MCP server ${pkg.version} ready on stdio`);
}
