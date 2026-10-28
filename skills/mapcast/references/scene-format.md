# Scene format reference

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

CLI: `npx -y mapcast render scene.json -o out.mp4` (or `.png`, `.gif`); add `--at <seconds>` for a still of an earlier moment.
The machine-readable version is `npx -y mapcast schema` (JSON Schema), which is also what the MCP tools advertise.
