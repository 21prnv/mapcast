# Contributing

Thanks for helping. mapcast is small on purpose: one scene format, one renderer, three ways in (CLI, MCP, skill).

## Setup

```bash
git clone https://github.com/21prnv/mapcast && cd mapcast
npm install
npm test                                    # validates every example scene
node bin/mapcast.js quick India -o out/india.png
```

You need Node 20+ and ffmpeg for video output. Chromium and map data download on first run.

## Where things live

| Path | What |
|---|---|
| `src/scene.js` | Scene defaults and validation (the source of truth) |
| `src/schema.js` | JSON Schema for the scene, served to AI tools; keep it in step with `scene.js` |
| `src/geo.js` | Borders, states, cities, projection, label placement |
| `src/tiles.js` | Basemap sources and their licences |
| `src/render.js` | Headless Chromium + ffmpeg pipeline |
| `src/page/draw.js` | Everything drawn in a frame: cameras, globe, styles, labels, effects |
| `src/mcp.js` | MCP server |
| `skills/mapcast` | The AI skill and its worked examples |

## Adding an option

1. Add it with a default in `src/scene.js` and describe it in `src/schema.js`.
2. Draw it in `src/page/draw.js`.
3. Document it in the README tables, then run `npm run docs:sync` to update the skill's reference.
4. Add a scene to `examples/` or a worked example to `skills/mapcast/references/examples.md`; `npm test` checks both.
5. Render it and look at the result before opening a pull request.

## Data and licences

Only add imagery, data or fonts whose licence allows free reuse in published videos, and record them in
`NOTICE.md`. Sentinel-2 cloudless years after 2016 are NonCommercial, so they cannot be added.

## Releasing

Bump `version` in `package.json` and `.claude-plugin/plugin.json`, update `CHANGELOG.md`, and publish a GitHub
release; the publish workflow runs the tests and publishes to npm through npm trusted publishing (no token).
