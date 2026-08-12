import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Babel from '@babel/standalone';

const design = await readFile('design/VeraCrypt Material.dc.html', 'utf8');
const production = await readFile('src/renderer/index.html', 'utf8');
const script = design.match(/<script\b[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script, 'Design logic script is missing.');
assert.doesNotThrow(() => Babel.transform(script, { sourceType: 'script' }), 'Design logic must compile as JavaScript.');
const requiredSurfaces = ['Volumes', 'Favorite Volumes', 'Volume Creation Wizard', 'Volume Properties', 'Security', 'Performance & Tools', 'File Converter', 'Ollama Studio', 'Preferences', 'History', 'Locked surfaces', 'Authenticator', 'Support Tickets', 'Settings'];
for (const surface of requiredSurfaces) assert.ok(design.includes(surface), `Design is missing ${surface}`);
for (const surface of requiredSurfaces) assert.ok(production.includes(surface), `Production renderer is missing ${surface}`);
assert.ok(production.includes('./bridge.js'), 'Production bridge is not loaded');
assert.ok(production.includes('Content-Security-Policy'), 'Production CSP is missing');
console.log(`PASS: design logic compiles and ${requiredSurfaces.length} designed surfaces are present in the production renderer.`);
