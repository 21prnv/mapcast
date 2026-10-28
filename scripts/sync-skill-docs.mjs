// Regenerates skills/mapcast/references/scene-format.md from the README's "Scene format" and "Data maps"
// sections, so the skill and the README never disagree. Run: npm run docs:sync
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readme = await readFile(new URL('README.md', root), 'utf8');
const section = (title) => {
  const start = readme.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`README has no "## ${title}" section`);
  const end = readme.indexOf('\n## ', start + 3);
  return readme.slice(start, end < 0 ? undefined : end).trim();
};

const out = `${section('Scene format').replace('## Scene format', '# Scene format reference')}

${section('Data maps')}

CLI: \`npx -y mapcast render scene.json -o out.mp4\` (or \`.png\`, \`.gif\`); add \`--at <seconds>\` for a still of an earlier moment.
The machine-readable version is \`npx -y mapcast schema\` (JSON Schema), which is also what the MCP tools advertise.
`;
await writeFile(new URL('skills/mapcast/references/scene-format.md', root), out);
console.log('updated skills/mapcast/references/scene-format.md');
