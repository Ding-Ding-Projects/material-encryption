import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const renderer = path.join(root, 'src', 'renderer');
const vendor = path.join(renderer, 'vendor');
const assets = path.join(renderer, 'assets');
await mkdir(vendor, { recursive: true });
await mkdir(assets, { recursive: true });

// Every transform below is written against LF newlines. A Windows checkout with
// core.autocrlf hands us CRLF, and a pattern containing a newline then matches
// nothing at all — the build still succeeds, and quietly ships the prototype's
// invented volumes as though they were real. Normalising on read is what makes
// that impossible rather than merely unlikely.
let html = (await readFile(path.join(root, 'design', 'VeraCrypt Material.dc.html'), 'utf8')).replace(/\r\n/g, '\n');

const requiredPrototypeMarkers = [
  '<sc-if value="{{ dialogPassword }}"',
  'const mounted = {',
  'const favData = [',
  'const hist = [',
  'notifications: ['
];
for (const marker of requiredPrototypeMarkers) {
  if (!html.includes(marker)) throw new Error('Design transformation marker is missing: ' + marker);
}

// A replacement that matches nothing is the failure this file is most prone to,
// and it is invisible: the output is simply the prototype. Every transform that
// must apply goes through this, so a design change that breaks one fails the
// build instead of shipping.
const applied = [];
function must(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Renderer transform "${label}" changed nothing. The design source no longer matches it.`);
  applied.push(label);
  return next;
}

const passwordDialogStart = html.indexOf('  <sc-if value="{{ dialogPassword }}"');
const passwordDialogEnd = html.indexOf('  <sc-if value="{{ dialogPalette }}"', passwordDialogStart);
if (passwordDialogStart < 0 || passwordDialogEnd < 0) throw new Error('The prototype password dialog could not be isolated.');
html = html.slice(0, passwordDialogStart) + html.slice(passwordDialogEnd);

// The prototype hard-codes four invented mounted volumes. The shipped app reads
// every drive letter from the operating system instead, and marks a row mounted
// only when its NT device target belongs to the VeraCrypt driver.
const liveDrives = [
  '  formatBytes(value) {',
  "    if (!Number.isFinite(value) || value <= 0) return '';",
  "    const units = ['B', 'KB', 'MB', 'GB', 'TB'];",
  '    let size = value, unit = 0;',
  '    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }',
  "    return (size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)) + ' ' + units[unit];",
  '  }',
  '',
  '  async loadDrives() {',
  '    const api = window.materialEncryption;',
  "    if (!api || typeof api.listDrives !== 'function') { this.setState({ drivesError: 'The volume bridge is unavailable in this build.' }); return; }",
  '    try {',
  '      const result = await api.listDrives();',
  '      if (result && result.ok) this.setState({ driveRows: result.value.drives, drivesError: result.value.error, drivesQueriedAt: result.value.queriedAt });',
  "      else this.setState({ drivesError: (result && result.error) || 'Drive letters could not be queried.' });",
  '    } catch (error) { this.setState({ drivesError: (error && error.message) || String(error) }); }',
  '  }',
  '',
  '  drivesData() {',
  '    const rows = Array.isArray(this.state.driveRows) ? this.state.driveRows : [];',
  '    return rows.map(row => ({',
  '      letter: row.letter,',
  "      path: row.device || '',",
  '      size: this.formatBytes(row.sizeBytes),',
  "      algo: row.mounted ? (row.fileSystem || 'Mounted') : '',",
  "      type: row.mounted ? 'VeraCrypt' : (row.device ? row.driveType : ''),",
  '      mounted: Boolean(row.mounted),',
  '      inUse: Boolean(row.device),',
  "      label: row.label || ''",
  '    }));',
  '  }',
  '',
  '  openMenu('
].join('\n');

html = must(html, /  drivesData\(\) \{\n    const mounted = \{[\s\S]*?\n  \}\n\n  openMenu\(/, liveDrives, 'live drive table');
html = must(
  html,
  "    menu: null, menuQuery: '', volumeSize: '12', sizeUnit: 'GB',",
  "    menu: null, menuQuery: '', volumeSize: '12', sizeUnit: 'GB',\n    driveRows: [], drivesError: null, drivesQueriedAt: null,",
  'drive state'
);
html = must(
  html,
  '    this.loadHarnessProfiles();\n  }',
  '    this.loadHarnessProfiles();\n    this.loadDrives();\n    this.driveTimer = setInterval(() => this.loadDrives(), 5000);\n  }',
  'drive poll'
);
html = must(html, 'clearInterval(this.converterQueueTimer); }', 'clearInterval(this.converterQueueTimer); clearInterval(this.driveTimer); }', 'drive poll teardown');
html = must(
  html,
  /    const props = \[[\s\S]*?\n    \];\n\n    const favData = \[[\s\S]*?\n    \];/,
  "    const props = [['Status', 'Open a container to read its real properties.']];\n\n    const favData = [];",
  'prototype properties and favourites'
);
// The prototype only ever labelled its four invented volumes, so every other
// letter rendered as an em dash. Real letters that are in use have a real type
// worth showing, and only genuinely free letters are blank.
html = must(
  html,
  "type: d.mounted ? d.type : '—',",
  "type: d.type || '—',",
  'drive type column'
);
html = must(html, /    const hist = \[[\s\S]*?\n    \];/, '    const hist = [];', 'prototype history');
html = must(html, /      notifications: \[[\s\S]*?\n      \],\n      toasts:/, '      notifications: [],\n      toasts:', 'prototype notifications');

html = html
  .replace('<script src="./support.js"></script>', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' material-logo: data:; connect-src \'none\'; font-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><script src="./vendor/react.production.min.js"></script><script src="./vendor/react-dom.production.min.js"></script><script src="./support.js"></script><script src="./bridge.js" defer></script>')
  .replace(/<link rel="preconnect"[^>]*>/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
  .replace(/VeraCrypt <span style="color:var\(--onv\);font-weight:400">Material<\/span>/g, 'Material <span style="color:var(--onv);font-weight:400">Encryption</span>')
  .replace(/updateReady: true/g, 'updateReady: false')
  .replace(/dialogPassword: s\.dialog === 'password', /g, '')
  .replace(/VeraCrypt Material/g, 'Material Encryption');

// Last line of defence: the prototype's invented paths must not reach the build,
// however the transforms above were edited.
const prototypeLeaks = ['Vaults\\archive-2026.hc', 'Vaults\\deniable.hc', 'Harddisk1\\Partition1', 'Harddisk2\\Partition3'];
const leaked = prototypeLeaks.filter((needle) => html.includes(needle));
if (leaked.length) throw new Error(`The generated renderer still contains prototype volume data: ${leaked.join(', ')}`);

await writeFile(path.join(renderer, 'index.html'), html, 'utf8');
let support = (await readFile(path.join(root, 'design', 'support.js'), 'utf8')).replace(/\r\n/g, '\n');
support = support
  .replace('https://unpkg.com/react@18.3.1/umd/react.production.min.js', './vendor/react.production.min.js')
  .replace('https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', './vendor/react-dom.production.min.js')
  .replace('https://unpkg.com/@babel/standalone@7.29.0/babel.min.js', './vendor/babel.min.js');
await writeFile(path.join(renderer, 'support.js'), support, 'utf8');
await copyFile(path.join(root, 'node_modules', 'react', 'umd', 'react.production.min.js'), path.join(vendor, 'react.production.min.js'));
await copyFile(path.join(root, 'node_modules', 'react-dom', 'umd', 'react-dom.production.min.js'), path.join(vendor, 'react-dom.production.min.js'));
await copyFile(path.join(root, 'node_modules', '@babel', 'standalone', 'babel.min.js'), path.join(vendor, 'babel.min.js'));
await copyFile(path.join(root, 'design', 'assets', 'material-encryption-logo.png'), path.join(assets, 'material-encryption-logo.png'));
console.log(`Prepared renderer from design/VeraCrypt Material.dc.html with local runtime assets (${applied.length} transforms applied: ${applied.join(', ')}).`);
