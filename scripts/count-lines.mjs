import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const rows = { Source: [0, 0], Tests: [0, 0], 'Styles and markup': [0, 0], Documentation: [0, 0], Design: [0, 0], Other: [0, 0] };
for (const file of files) {
  if (/\.(png|ico|exe|nupkg)$/i.test(file)) continue;
  let text; try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
  const key = file.startsWith('tests/') ? 'Tests' : file.startsWith('design/') ? 'Design' : file.startsWith('docs/') || /^(README|ROADMAP|HANDOFF|SECURITY|CONTRIBUTING|CODE_OF_CONDUCT)\.md$/.test(file) ? 'Documentation' : /\.(html|css)$/.test(file) ? 'Styles and markup' : /\.(cjs|mjs|js|ts)$/.test(file) ? 'Source' : 'Other';
  rows[key][0] += lines.length; rows[key][1] += lines.filter((line) => line.trim()).length;
}
console.log('| Category | Total lines | Non-blank lines |');
console.log('|---|---:|---:|');
let total = 0, nonblank = 0;
for (const [key, [all, non]] of Object.entries(rows)) { console.log(`| ${key} | ${all} | ${non} |`); total += all; nonblank += non; }
console.log(`| Grand total | ${total} | ${nonblank} |`);
console.log('\nExcluded: dependency directories, build output, lockfiles, and binary artifacts. Design is reported separately from hand-written production source.');
