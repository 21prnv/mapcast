# mapcast

Animated map videos and images from a tiny JSON scene. Highlight any country on real satellite imagery,
with a tracing border, colour fill, glow and label, the way documentary and explainer channels do it.
Free, open source and built so AI agents can drive it.

```bash
npx mapcast quick India -o india.mp4
npx mapcast quick "United States" --style highlight --color yellow -o usa.png
npx mapcast quick France Spain Germany --camera zoom-in -o europe.mp4
npx mapcast quick France --style flag -o france.mp4
npx mapcast quick Brazil --camera globe -o brazil.mp4         # dive in from a spinning Earth
npx mapcast quick India France Japan --camera fly -o tour.mp4  # fly from country to country
```

Every example in [`examples/`](examples) renders as-is: `mapcast render examples/france-flag.json -o france.mp4`.

## Scene format

```json
{
  "aspect": "16:9",
  "duration": 5,
  "camera": "push-in",
  "highlights": [
    { "country": "India", "style": "solid", "color": "#c8102e", "label": "INDIA" }
  ]
}
```

| Field | Values | Default |
|---|---|---|
| `aspect` | `16:9`, `9:16`, `1:1`, `4:5` (or set `width`/`height`) | `16:9` |
| `duration` | seconds | `5` (`7` for `globe`, `1 + 3` per country for `fly`) |
| `fps` | frames per second | `30` |
| `camera` | `push-in`, `zoom-in`, `globe` (3D Earth dive), `fly` (country to country), `static`, or `{ "move", "fill", "from" }` | `push-in` |
| `basemap` | `satellite`, `bluemarble`, `sentinel`, `paper` (old parchment map) | `satellite` |
| `pov` | `auto` (the country's own official borders), `default`, or a code like `ind`, `chn`, `pak` | `auto` |
| `effects.grade` | `natural`, `muted`, `mono` | `natural` |
| `effects.vignette` | 0 to 1 | `0.45` |
| `effects.blur` | 0 to 1: soft-focus edges, like a camera lens | `0` |
| `effects.grid` | `true` or `{ "step", "color", "opacity" }`: lat/long grid over the sea only | off |
| `effects.borders` | `true`: thin borders of neighbouring countries | on for `paper` |
| `labelAnim` | default label animation for every highlight | `rise` |

Each highlight:

| Field | Values | Default |
|---|---|---|
| `country` | name (`"India"`) or ISO code (`"IN"`, `"IND"`) | `country` or `region` required |
| `region` | a state or province: `"California"`, `"Bavaria"`, `"US-CA"`, `"IN-MH"` | |
| `style` | `solid` (tinted fill), `highlight` (rest of the world goes grey), `outline`, `flag` (the country's flag over the terrain) | `solid` |
| `color` | any CSS colour or `red`, `yellow`, `blue`, ... | a distinct colour per country |
| `label` | text, or `false` for none | the country name |
| `border` | `{ "color", "width", "glow" }` or `false` | white, glowing |
| `labelAnim` | `rise`, `type` (typewriter), `spread` (letters close in), `slide`, `pop` | `rise` |
| `labelSize` | multiplier on the automatic label size, e.g. `0.7` or `1.3` | `1` |
| `labelFont` | `sans`, `serif`, or any font name | `sans` (`serif` on paper) |
| `capital` | `true` for the capital (a state's own capital for `region`), or a city name like `"Mumbai"` | off |
| `start` | seconds when this country starts animating | staggered automatically |

## Data maps

Colour countries by a number, with a legend:

```json
{
  "data": {
    "title": "GDP 2024 (trillion US$)",
    "prefix": "$",
    "unit": "T",
    "scheme": "heat",
    "values": { "India": 3.9, "China": 18.7, "Japan": 4.1 }
  }
}
```

`scheme` is one of `reds`, `blues`, `greens`, `heat`, `purples`, `diverging`, or a list of colours.
Set `"labels"` to `"name"`, `"value"` (the number with `prefix`/`unit`) or `"both"` to label each country,
and `min`/`max` to fix the colour range. A highlight's `label` can have a second line: `"INDIA\n1.4 BILLION"`.

Render it:

```bash
mapcast render scene.json -o out.mp4     # video
mapcast render scene.json -o out.png     # still of the final frame
mapcast render scene.json -o out.png --at 1.2
cat scene.json | mapcast render - -o out.gif
```

## Use it from AI tools

mapcast ships three ways in. All of them render with the same engine and the same scene format.

**Claude Code plugin** (skill + MCP server in one install):

```
/plugin marketplace add <owner>/mapcast
/plugin install mapcast@mapcast
```

Then just ask: "make a YouTube Short of Japan with its flag" or "old map of Egypt with Cairo marked".

**MCP server** for Claude Desktop, Cursor, Windsurf, Codex and any other MCP client. Add to the client's MCP config:

```json
{
  "mcpServers": {
    "mapcast": { "command": "npx", "args": ["-y", "mapcast", "mcp"] }
  }
}
```

It exposes `render_map` (saves the video or image and returns a preview of the final frame) and `preview_map`
(one frame, to check a scene before rendering). The full scene schema is in the tool definitions.

**Skill only** (for agents that read `SKILL.md` skills but run commands themselves):

```bash
npx skills add <owner>/mapcast
```

The skill lives in [`skills/mapcast`](skills/mapcast), with [27 worked request-to-scene examples](skills/mapcast/references/examples.md).

## Requirements

Node 20+, `ffmpeg` on your PATH, and Chromium for Playwright (`npx playwright install chromium`).
Map data downloads once and is cached in `~/.cache/mapcast`.

`npm test` checks every example scene (including the skill's) against the schema and resolves every country and city.

## Licence

MIT. Map data and font licences are listed in [NOTICE.md](NOTICE.md); credit the imagery source that
`mapcast` prints after each render.
