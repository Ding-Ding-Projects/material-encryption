import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const design = await readFile('design/VeraCrypt Material.dc.html', 'utf8');
const production = await readFile('src/renderer/index.html', 'utf8');
const requiredSurfaces = ['Volumes', 'Favorite Volumes', 'Volume Creation Wizard', 'Volume Properties', 'Security', 'Performance & Tools', 'Preferences', 'History', 'Locked surfaces', 'Authenticator', 'Support Tickets', 'Settings'];
for (const surface of requiredSurfaces) assert.ok(design.includes(surface), `Design is missing ${surface}`);
for (const surface of requiredSurfaces) assert.ok(production.includes(surface), `Production renderer is missing ${surface}`);
assert.ok(production.includes('./bridge.js'), 'Production bridge is not loaded');
assert.ok(production.includes('Content-Security-Policy'), 'Production CSP is missing');
console.log(`PASS: ${requiredSurfaces.length} designed surfaces are present in the production renderer.`);
