// Every shipped scene (examples/*.json and the skill's worked examples) must match the schema,
// normalize without errors, and resolve every country and city. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { sceneSchema } from '../src/schema.js';
import { normalizeScene } from '../src/scene.js';
import { findCity, resolveCountries } from '../src/geo.js';

const root = new URL('../', import.meta.url);
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(sceneSchema);

async function scenes() {
  const out = [];
  for (const f of (await readdir(new URL('examples/', root))).filter((f) => f.endsWith('.json'))) {
    out.push([`examples/${f}`, JSON.parse(await readFile(new URL(`examples/${f}`, root), 'utf8'))]);
  }
  const md = await readFile(new URL('skills/mapcast/references/examples.md', root), 'utf8');
  let title = '';
  for (const block of md.split('\n## ').slice(1)) {
    title = block.split('\n')[0];
    const json = block.match(/```json\n([\s\S]*?)```/);
    if (json) out.push([`examples.md: ${title}`, JSON.parse(json[1])]);
  }
  return out;
}

for (const [name, scene] of await scenes()) {
  test(name, async () => {
    assert.ok(validate(scene), JSON.stringify(validate.errors, null, 2));
    const s = normalizeScene(scene);
    const { matched } = await resolveCountries(s.highlights.map((h) => h.country), s.pov);
    for (const [i, h] of s.highlights.entries()) {
      if (h.capital) assert.ok(await findCity(matched[i].properties.ADM0_A3, h.capital), `no city "${h.capital}" in ${h.country}`);
    }
  });
}

test('schema rejects unknown fields and bad values', () => {
  assert.equal(validate({ highlights: [{ country: 'India', colour: 'red' }] }), false);
  assert.equal(validate({ highlights: [{ country: 'India', style: 'neon' }] }), false);
  assert.equal(validate({ aspect: '16:9' }), false);
});
