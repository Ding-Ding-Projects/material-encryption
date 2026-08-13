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

// Reading the real drive list takes a moment, and it can fail. Without a status
// row the table renders as a bare header with nothing under it, which reads as a
// broken app rather than a pending query — and an outright failure would show
// the same empty header forever, saying nothing about what went wrong.
html = must(
  html,
  '                <sc-for list="{{ drives }}" as="d" hint-placeholder-count="12">',
  '                <sc-if value="{{ drivesStatus }}">\n' +
  '                  <div style="padding:18px;color:var(--onv);font:400 13px Roboto,sans-serif">{{ drivesStatus }}</div>\n' +
  '                </sc-if>\n' +
  '                <sc-for list="{{ drives }}" as="d" hint-placeholder-count="12">',
  'drive table status row'
);
html = must(
  html,
  '      drives: drives.map((d, i) => ({',
  '      drivesStatus: s.drivesError\n' +
  "        ? 'Drive letters could not be read: ' + s.drivesError\n" +
  "        : (s.driveRows.length ? '' : 'Reading the drive letters on this machine…'),\n" +
  '      drives: drives.map((d, i) => ({',
  'drive table status text'
);
html = must(
  html,
  /    const props = \[[\s\S]*?\n    \];\n\n    const favData = \[[\s\S]*?\n    \];/,
  '    const props = this.propertyRows();\n\n    const favData = [];',
  'prototype properties and favourites'
);

// The Properties destination is now driven by the engine's own header read. The
// user picks a container and supplies its password; nothing is displayed that
// did not come back from verifyVolume, and the password is dropped as soon as
// the two reads that need it have finished.
const propertyReader = [
  '  async selectPropertiesVolume() {',
  '    const api = window.materialEncryption;',
  "    if (!api || typeof api.selectVolume !== 'function') { this.setState({ propsError: 'The volume bridge is unavailable in this build.' }); return; }",
  '    try {',
  '      const result = await api.selectVolume();',
  '      const picked = result && result.ok ? result.value : null;',
  '      if (picked) this.setState({ propsVolume: picked, propsInfo: null, propsUsage: null, propsUsageError: null, propsError: null });',
  "      else if (result && result.ok === false) this.setState({ propsError: result.error || 'The container could not be selected.' });",
  '    } catch (error) { this.setState({ propsError: (error && error.message) || String(error) }); }',
  '  }',
  '',
  '  async readProperties() {',
  '    const api = window.materialEncryption;',
  "    if (!api || typeof api.verifyVolume !== 'function') { this.setState({ propsError: 'The volume bridge is unavailable in this build.' }); return; }",
  '    const volume = (this.state.propsVolume || \'\').trim();',
  "    if (!volume) { this.setState({ propsError: 'Choose a container first.' }); return; }",
  '    const password = this.state.propsPassword;',
  '    const pim = Number(this.state.propsPim) || 0;',
  '    this.setState({ propsBusy: true, propsError: null, propsInfo: null, propsUsage: null, propsUsageError: null });',
  '    try {',
  "      const header = await api.verifyVolume({ volume, password, pim, prf: 'Autodetection', useBackupHeader: false });",
  "      if (!header || !header.ok) { this.setState({ propsBusy: false, propsPassword: '', propsError: (header && header.error) || 'The container header could not be read.' }); return; }",
  '      let usage = null, usageError = null;',
  '      try {',
  "        const files = await api.listVolumeFiles({ volume, password, pim, prf: 'Autodetection', path: '/' });",
  '        if (files && files.ok && files.value && files.value.usage) usage = files.value.usage;',
  "        else usageError = (files && files.error) || 'The filesystem inside the container reported no usage figures.';",
  '      } catch (error) { usageError = (error && error.message) || String(error); }',
  "      this.setState({ propsBusy: false, propsPassword: '', propsInfo: header.value, propsUsage: usage, propsUsageError: usageError });",
  "    } catch (error) { this.setState({ propsBusy: false, propsPassword: '', propsError: (error && error.message) || String(error) }); }",
  '  }',
  '',
  '  propertyRows() {',
  '    const info = this.state.propsInfo;',
  '    if (!info) return [];',
  '    const rows = [',
  "      ['Location', info.path],",
  "      ['Container file size', this.formatBytes(info.fileSize) + ' (' + info.fileSize + ' bytes)'],",
  "      ['Volume size', this.formatBytes(info.volumeSize)],",
  "      ['Data area size', this.formatBytes(info.dataSize)],",
  "      ['Encryption algorithm', info.cipher],",
  "      ['Key derivation function', info.prf],",
  "      ['PIM', String(info.pim)],",
  "      ['Iterations', String(info.iterations)],",
  "      ['Sector size', info.sectorSize + ' bytes'],",
  "      ['Volume header version', String(info.headerVersion)],",
  "      ['Hidden volume', info.hidden ? 'Yes' : 'No'],",
  "      ['Backup header used', info.usedBackupHeader ? 'Yes' : 'No']",
  '    ];',
  '    const usage = this.state.propsUsage;',
  '    if (usage) {',
  "      rows.push(['Filesystem label', usage.label || '(none)']);",
  "      rows.push(['Filesystem total', this.formatBytes(usage.totalBytes)]);",
  "      rows.push(['Filesystem used', this.formatBytes(usage.usedBytes)]);",
  "      rows.push(['Filesystem free', this.formatBytes(usage.freeBytes)]);",
  "    } else if (this.state.propsUsageError) rows.push(['Filesystem usage', 'Not read: ' + this.state.propsUsageError]);",
  '    return rows;',
  '  }',
  '',
  '  openMenu('
].join('\n');
html = must(html, '  openMenu(', propertyReader, 'volume property reader');
html = must(
  html,
  '    driveRows: [], drivesError: null, drivesQueriedAt: null,',
  '    driveRows: [], drivesError: null, drivesQueriedAt: null,\n' +
  "    propsVolume: '', propsPassword: '', propsPim: '', propsInfo: null, propsUsage: null, propsUsageError: null, propsError: null, propsBusy: false,",
  'volume property state'
);
html = must(
  html,
  '      properties: props.map((p, i) => ({',
  '      propsVolume: s.propsVolume,\n' +
  '      setPropsVolume: (e) => this.setState({ propsVolume: e.target.value, propsInfo: null, propsUsage: null, propsUsageError: null, propsError: null }),\n' +
  '      propsPassword: s.propsPassword, setPropsPassword: (e) => this.setState({ propsPassword: e.target.value }),\n' +
  '      propsPim: s.propsPim, setPropsPim: (e) => this.setState({ propsPim: e.target.value }),\n' +
  '      browseProperties: () => this.selectPropertiesVolume(),\n' +
  '      readProperties: () => this.readProperties(),\n' +
  '      propsStatus: s.propsBusy\n' +
  "        ? 'Reading the container header…'\n" +
  '        : (s.propsError\n' +
  "          ? s.propsError\n" +
  "          : (props.length ? '' : (s.propsVolume.trim() ? 'Enter the container password, then read its properties.' : 'Choose a container, then enter its password.'))),\n" +
  '      properties: props.map((p, i) => ({',
  'volume property bindings'
);
html = must(
  html,
  '          <sc-if value="{{ isProperties }}" hint-placeholder-val="{{ true }}">\n' +
  '            <div style="background:var(--s1);border:1px solid var(--outv);border-radius:16px;overflow:hidden">\n' +
  '              <sc-for list="{{ properties }}" as="p" hint-placeholder-count="14">',
  '          <sc-if value="{{ isProperties }}" hint-placeholder-val="{{ true }}">\n' +
  '            <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px">\n' +
  '              <input value="{{ propsVolume }}" onChange="{{ setPropsVolume }}" placeholder="Select or type a container path" style="flex:1;min-width:260px;background:var(--s1);border:1px solid var(--outv);border-radius:12px;color:var(--on);padding:12px 14px;font-family:Roboto Mono,monospace;outline:none">\n' +
  '              <button onClick="{{ browseProperties }}" style="padding:11px 20px;border-radius:20px;border:1px solid var(--outv);background:transparent;color:var(--on);cursor:pointer">Browse…</button>\n' +
  '              <input type="password" value="{{ propsPassword }}" onChange="{{ setPropsPassword }}" placeholder="Password" style="width:200px;background:var(--s1);border:1px solid var(--outv);border-radius:12px;color:var(--on);padding:12px 14px;outline:none">\n' +
  '              <input value="{{ propsPim }}" onChange="{{ setPropsPim }}" placeholder="PIM" style="width:90px;background:var(--s1);border:1px solid var(--outv);border-radius:12px;color:var(--on);padding:12px 14px;text-align:right;font-family:Roboto Mono,monospace;outline:none">\n' +
  '              <button onClick="{{ readProperties }}" style="padding:11px 24px;border-radius:20px;border:0;background:var(--p);color:var(--op);font-weight:500;cursor:pointer">Read properties</button>\n' +
  '            </div>\n' +
  '            <div style="background:var(--s1);border:1px solid var(--outv);border-radius:16px;overflow:hidden">\n' +
  '              <sc-if value="{{ propsStatus }}">\n' +
  '                <div style="padding:18px;color:var(--onv);font:400 13px Roboto,sans-serif">{{ propsStatus }}</div>\n' +
  '              </sc-if>\n' +
  '              <sc-for list="{{ properties }}" as="p" hint-placeholder-count="14">',
  'volume property controls'
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
