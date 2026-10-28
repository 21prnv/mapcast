# mapcast

Animated map videos and images from a tiny JSON scene. Highlight any country on real satellite imagery,
with a tracing border, colour fill, glow and label, the way documentary and explainer channels do it.
Free, open source and built so AI agents can drive it.

```bash
npx mapcast quick India -o india.mp4
npx mapcast quick "United States" --style highlight --color yellow -o usa.png
npx mapcast quick France Spain Germany --camera zoom-in -o europe.mp4
```

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
| `duration` | seconds | `5` |
| `fps` | frames per second | `30` |
| `camera` | `push-in`, `zoom-in`, `static`, or `{ "move", "fill", "from" }` | `push-in` |
| `basemap` | `satellite`, `bluemarble`, `sentinel` | `satellite` |
| `pov` | `auto` (the country's own official borders), `default`, or a code like `ind`, `chn`, `pak` | `auto` |
| `effects.grade` | `natural`, `muted`, `mono` | `natural` |
| `effects.vignette` | 0 to 1 | `0.45` |

Each highlight:

| Field | Values | Default |
|---|---|---|
| `country` | name (`"India"`) or ISO code (`"IN"`, `"IND"`) | required |
| `style` | `solid` (tinted fill), `highlight` (rest of the world goes grey), `outline` | `solid` |
| `color` | any CSS colour or `red`, `yellow`, `blue`, ... | a distinct colour per country |
| `label` | text, or `false` for none | the country name |
| `border` | `{ "color", "width", "glow" }` or `false` | white, glowing |
| `start` | seconds when this country starts animating | staggered automatically |

Render it:

```bash
mapcast render scene.json -o out.mp4     # video
mapcast render scene.json -o out.png     # still of the final frame
mapcast render scene.json -o out.png --at 1.2
cat scene.json | mapcast render - -o out.gif
```

## Requirements

Node 20+, `ffmpeg` on your PATH, and Chromium for Playwright (`npx playwright install chromium`).
Map data downloads once and is cached in `~/.cache/mapcast`.

## Licence

MIT. Map data and font licences are listed in [NOTICE.md](NOTICE.md); credit the imagery source that
`mapcast` prints after each render.
