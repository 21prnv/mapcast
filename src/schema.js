// JSON Schema for a scene. Served to AI tools (MCP inputSchema, `mapcast schema`) so they know every option.
// normalizeScene() in scene.js is the source of truth for defaults and validation; keep the two in step.
import { GRADES, LABEL_ANIMS, MOVES, SCHEMES, STYLES } from './scene.js';

const colorProp = (description) => ({ type: 'string', description: `${description} Any CSS colour ("#c8102e", "rgb(...)") or a name: red, crimson, yellow, gold, orange, green, teal, blue, navy, purple, pink, white, black.` });

const highlight = {
  type: 'object',
  required: ['country'],
  additionalProperties: false,
  properties: {
    country: { type: 'string', description: 'Country name ("India", "United States") or ISO code ("IN", "IND").' },
    style: {
      type: 'string', enum: STYLES,
      description: 'solid: colour tint over the terrain. highlight: the country keeps colour while the rest of the world turns grey. outline: border only. flag: the national flag laid over the terrain.',
    },
    color: colorProp('Fill colour. Defaults to a distinct colour per country (yellow for the first "highlight").'),
    opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Fill strength. Default 0.92 (0.75 on paper).' },
    label: { anyOf: [{ type: 'string' }, { const: false }], description: 'Text on the country. Default: its name in capitals. false for none. "\\n" starts a smaller second line, e.g. "INDIA\\n1.4 BILLION".' },
    labelColor: colorProp('Label colour. Default white (ink on paper).'),
    labelFont: { type: 'string', description: '"sans" (Montserrat), "serif" (Cinzel), or an installed font family. Default sans, serif on paper.' },
    labelWeight: { type: 'number', description: 'Font weight, 100-900. Default 700.' },
    labelSize: { type: 'number', minimum: 0.2, maximum: 4, description: 'Multiplier on the automatic label size (also scales the city name). 0.7 shrinks a label that overflows a small country; 1.3 enlarges. Default 1.' },
    labelAnim: { type: 'string', enum: LABEL_ANIMS, description: 'rise (default), type (typewriter), spread (letters close in), slide, pop.' },
    capital: { anyOf: [{ type: 'boolean' }, { type: 'string' }], description: 'true marks the capital with a pulsing dot and its name; a string marks that city instead ("Mumbai").' },
    border: {
      anyOf: [{ const: false }, {
        type: 'object', additionalProperties: false,
        properties: {
          color: colorProp('Border colour. Default white (ink on paper).'),
          width: { type: 'number', description: 'Pixels at 1080p. Default 3.' },
          glow: { type: 'number', minimum: 0, maximum: 2, description: 'Glow strength. 0 = none. Default 0.35 for solid, 0.8 otherwise, 0 on paper.' },
          glowColor: colorProp('Glow colour if different from the border.'),
        },
      }],
      description: 'Border line, traced on as the animation starts. false for none.',
    },
    start: { type: 'number', minimum: 0, description: 'Second at which this country starts animating. Default: staggered automatically.' },
  },
};

export const sceneSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'mapcast scene',
  description: 'An animated map: one or more highlighted countries, a basemap, a camera move and effects. Needs "highlights" or "data".',
  type: 'object',
  additionalProperties: false,
  properties: {
    highlights: { type: 'array', minItems: 1, items: highlight, description: 'Countries to highlight, animated one after another.' },
    data: {
      type: 'object',
      description: 'Data map: colour countries by a number and show a legend. Can be combined with highlights.',
      required: ['values'],
      additionalProperties: false,
      properties: {
        values: { type: 'object', additionalProperties: { type: 'number' }, description: '{ "Country": number }, e.g. { "India": 3.9, "China": 18.7 }.' },
        title: { type: 'string', description: 'Legend title, e.g. "GDP 2024 (trillion US$)".' },
        scheme: { anyOf: [{ type: 'string', enum: Object.keys(SCHEMES) }, { type: 'array', items: { type: 'string' }, minItems: 2 }], description: 'Colour ramp name or a list of colours from low to high. Default "reds".' },
        prefix: { type: 'string', description: 'Shown before legend numbers, e.g. "$".' },
        unit: { type: 'string', description: 'Shown after legend numbers, e.g. "%", "T", "M".' },
        min: { type: 'number' },
        max: { type: 'number' },
        labels: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['name', 'value', 'both'] }], description: 'Label each country: "name" (or true), "value" (the number with prefix/unit, e.g. "11.4%"), or "both" (name over number). Default none: labels crowd on dense maps.' },
      },
    },
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5'], description: '16:9 for YouTube (default), 9:16 for Shorts/Reels/TikTok, 1:1 or 4:5 for feeds.' },
    width: { type: 'integer', minimum: 64, maximum: 4096 },
    height: { type: 'integer', minimum: 64, maximum: 4096 },
    duration: { type: 'number', exclusiveMinimum: 0, maximum: 120, description: 'Seconds. Default 5.' },
    fps: { type: 'integer', minimum: 1, maximum: 60, description: 'Default 30.' },
    basemap: { type: 'string', enum: ['satellite', 'bluemarble', 'sentinel', 'paper'], description: 'satellite (default, NASA Blue Marble + Sentinel-2 close up), paper (old parchment map), bluemarble, sentinel.' },
    pov: { type: 'string', description: 'Whose official view of disputed borders to draw. "auto" (default) uses the highlighted country\'s own view; "default" is Natural Earth\'s; or a code like "ind", "chn", "pak".' },
    camera: {
      anyOf: [{ type: 'string', enum: MOVES }, {
        type: 'object', additionalProperties: false,
        properties: {
          move: { type: 'string', enum: MOVES },
          fill: { type: 'number', minimum: 0.1, maximum: 1, description: 'How much of the frame the countries fill. Default 0.72.' },
          from: { type: 'number', minimum: 0.01, maximum: 1, description: 'zoom-in only: starting zoom relative to the final shot. Default 0.2.' },
        },
      }],
      description: 'push-in (default, slow drift closer), zoom-in (from a wide view down to the country), static.',
    },
    style: { type: 'string', enum: STYLES, description: 'Default style for every highlight.' },
    labelAnim: { type: 'string', enum: LABEL_ANIMS, description: 'Default label animation for every highlight.' },
    effects: {
      type: 'object', additionalProperties: false,
      properties: {
        grade: { type: 'string', enum: GRADES, description: 'Colour grade of the basemap: natural (default), muted, mono.' },
        vignette: { type: 'number', minimum: 0, maximum: 1, description: 'Darkened corners. Default 0.45.' },
        blur: { type: 'number', minimum: 0, maximum: 1, description: 'Soft-focus edges like a camera lens. Default 0. Try 0.6-0.8.' },
        grid: {
          anyOf: [{ type: 'boolean' }, {
            type: 'object', additionalProperties: false,
            properties: { step: { type: 'number', description: 'Degrees between lines. Default: automatic.' }, color: colorProp('Line colour.'), opacity: { type: 'number', minimum: 0, maximum: 1 } },
          }],
          description: 'Latitude/longitude grid drawn over the sea only.',
        },
        borders: { type: 'boolean', description: 'Thin borders of neighbouring countries. Default on for paper, off otherwise.' },
      },
    },
  },
  anyOf: [{ required: ['highlights'] }, { required: ['data'] }],
};
