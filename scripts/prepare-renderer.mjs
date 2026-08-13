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
// The prototype's context menu could only be dismissed by clicking its scrim or
// activating an entry. Escape did nothing to it — the key handler cleared the
// dialog state and left `menu` set — and nothing returned focus to the control
// the menu was opened from, so a keyboard user was stranded on a surface with no
// way out. One close path now serves every route and restores that focus.
html = must(
  html,
  '  openMenu(e, title, items) {\n    e.preventDefault();\n    e.stopPropagation();\n',
  [
    '  closeAppMenu(restoreFocus) {',
    '    const opener = this.menuOpener;',
    '    this.menuOpener = null;',
    "    if (this.state.menu) this.setState({ menu: null, menuQuery: '' });",
    "    if (restoreFocus !== false && opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();",
    '  }',
    '',
    '  openMenu(e, title, items) {',
    '    e.preventDefault();',
    '    e.stopPropagation();',
    '    this.menuOpener = e.currentTarget instanceof HTMLElement ? e.currentTarget : document.activeElement;',
    ''
  ].join('\n'),
  'context menu close path'
);
html = must(
  html,
  "else if (e.key === 'Escape') this.setState({ dialog: null, keyA: false, keyL: false });",
  "else if (e.key === 'Escape') { if (this.state.menu) { e.preventDefault(); this.closeAppMenu(); return; } this.setState({ dialog: null, keyA: false, keyL: false }); }",
  'context menu escape close'
);
html = must(
  html,
  '      closeMenu: () => this.setState({ menu: null }),',
  '      closeMenu: () => this.closeAppMenu(),',
  'context menu scrim close'
);
// An entry that opens a dialog must not have focus yanked back to the control
// behind it, so activation closes the menu without restoring focus.
html = must(
  html,
  '        run: () => { this.setState({ menu: null }); if (m[1]) m[1](); },',
  '        run: () => { this.closeAppMenu(false); if (m[1]) m[1](); },',
  'context menu item activation close'
);
// The prototype's benchmark table was seven invented rows, two of them for
// ciphers this build cannot perform at all. The table now starts empty and is
// filled only by a measurement the main process actually performed.
html = must(html, /    const bench = \[[\s\S]*?\n    \];/, '    const bench = [];', 'prototype benchmark rows');
html = must(
  html,
  '    driveRows: [], drivesError: null, drivesQueriedAt: null,',
  '    driveRows: [], drivesError: null, drivesQueriedAt: null,\n    benchmarkResult: null, benchmarkError: null, benchmarkRunning: false,',
  'benchmark state'
);
html = must(
  html,
  '  drivesData() {',
  [
    '  formatThroughput(value) {',
    "    if (!Number.isFinite(value) || value <= 0) return '—';",
    "    return (value >= 100 ? Math.round(value) : value.toFixed(1)) + ' MB/s';",
    '  }',
    '',
    '  async runBenchmark() {',
    '    if (this.state.benchmarkRunning) return;',
    '    const api = window.materialEncryption;',
    "    if (!api || typeof api.runBenchmark !== 'function') { this.setState({ benchmarkError: 'The benchmark bridge is unavailable in this build.' }); return; }",
    '    this.setState({ benchmarkRunning: true, benchmarkError: null });',
    '    try {',
    '      const result = await api.runBenchmark();',
    '      if (result && result.ok) this.setState({ benchmarkResult: result.value, benchmarkError: null });',
    "      else this.setState({ benchmarkError: (result && result.error) || 'The benchmark could not be run.' });",
    '    } catch (error) { this.setState({ benchmarkError: (error && error.message) || String(error) }); }',
    '    this.setState({ benchmarkRunning: false });',
    '  }',
    '',
    '  benchmarkData() {',
    '    const result = this.state.benchmarkResult;',
    '    if (!result || !Array.isArray(result.rows)) return [];',
    '    return result.rows.map(row => row.available',
    '      ? { algo: row.label, enc: this.formatThroughput(row.encryptMbPerSecond), dec: this.formatThroughput(row.decryptMbPerSecond), mean: this.formatThroughput(row.meanMbPerSecond) }',
    "      : { algo: row.label, enc: 'Unavailable', dec: '—', mean: '—' });",
    '  }',
    '',
    '  drivesData() {'
  ].join('\n'),
  'benchmark runner'
);
html = must(
  html,
  /      benchmark: bench\.map\(\(b, i\) => \(\{\n[\s\S]*?\n      \}\)\),/,
  [
    '      benchmark: this.benchmarkData().map((b, i, all) => ({',
    '        algo: b.algo, enc: b.enc, dec: b.dec, mean: b.mean,',
    "        style: 'display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:12px;padding:11px 16px;background:var(--s1);border-bottom:' + (i === all.length - 1 ? '0' : '1px solid var(--outv)')",
    '      })),',
    '      benchmarkStatus: s.benchmarkError',
    "        ? 'The benchmark could not be run: ' + s.benchmarkError",
    "        : (s.benchmarkRunning ? 'Running the benchmark on this machine…' : (s.benchmarkResult ? '' : 'Not run yet — no throughput has been measured on this machine.')),",
    '      benchmarkNote: s.benchmarkResult',
    "        ? 'Measured here: ' + Math.round(s.benchmarkResult.bufferBytes / 1048576) + ' MiB encrypted and decrypted through ' + s.benchmarkResult.dataUnitBytes + '-byte XTS data units, ' + s.benchmarkResult.iterations + ' pass(es) per direction.' + s.benchmarkResult.rows.filter(r => !r.available).map(r => ' ' + r.label + ': ' + r.reason).join('')",
    "        : '',",
    "      benchmarkButtonLabel: s.benchmarkRunning ? 'Running…' : 'Run benchmark',",
    '      runBenchmark: () => this.runBenchmark(),'
  ].join('\n'),
  'benchmark table data'
);
html = must(
  html,
  '                  <sc-for list="{{ benchmark }}" as="b" hint-placeholder-count="7">',
  '                  <sc-if value="{{ benchmarkStatus }}">\n' +
  '                    <div style="padding:18px;color:var(--onv);font:400 13px Roboto,sans-serif">{{ benchmarkStatus }}</div>\n' +
  '                  </sc-if>\n' +
  '                  <sc-if value="{{ benchmarkNote }}">\n' +
  '                    <div style="padding:12px 16px;color:var(--onv);font:400 12px Roboto,sans-serif;border-bottom:1px solid var(--outv)">{{ benchmarkNote }}</div>\n' +
  '                  </sc-if>\n' +
  '                  <sc-for list="{{ benchmark }}" as="b" hint-placeholder-count="7">',
  'benchmark table status row'
);
html = must(
  html,
  '<button style="padding:10px 20px;border-radius:20px;border:0;background:var(--pc);color:var(--opc);font-weight:500;cursor:pointer">Run benchmark</button>',
  '<button onClick="{{ runBenchmark }}" style="padding:10px 20px;border-radius:20px;border:0;background:var(--pc);color:var(--opc);font-weight:500;cursor:pointer">{{ benchmarkButtonLabel }}</button>',
  'benchmark run button'
);

html = must(html, /    const hist = \[[\s\S]*?\n    \];/, '    const hist = [];', 'prototype history');
html = must(html, /      notifications: \[[\s\S]*?\n      \],\n      toasts:/, '      notifications: [],\n      toasts:', 'prototype notifications');

// ---------------------------------------------------------------------------
// Volume creation wizard.
//
// The prototype's seventh step was a picture of a formatter: a constant 63%, a
// constant 148 MB/s, a constant four-group entropy pool, and a Next button that
// asked VeraCrypt to open its own wizard. None of it created anything. Every
// number on that step is now measured, and the button calls the container
// engine this application already ships.

const wizardState = [
  "    volumeType: 'standard', favIndex: 0, favLabel: 'Archive 2026', flags: {},",
  "    volumeCaps: null, volumeCapsError: '', wizardBusy: false, wizardError: '', wizardResult: null,",
  "    wizardPhase: '', wizardDone: 0, wizardTotal: 0, wizardStartedAt: 0, wizardElapsedMs: 0,",
  "    entropyPool: '', entropyMouseMixes: 0,"
].join('\n');
html = must(
  html,
  "    volumeType: 'standard', favIndex: 0, favLabel: 'Archive 2026', flags: {},",
  wizardState,
  'wizard state'
);

// The cipher and hash inventories are read from the engine rather than listed
// here, so a cipher this build cannot write is never offered as though it could.
const wizardMethods = [
  '  loadVolumeCapabilities() {',
  '    const api = window.materialEncryption;',
  "    if (!api || typeof api.volumeCapabilities !== 'function') { this.setState({ volumeCapsError: 'The volume bridge is unavailable in this build.' }); return; }",
  '    Promise.resolve(api.volumeCapabilities()).then((result) => {',
  "      if (result && result.ok) this.setState({ volumeCaps: result.value, volumeCapsError: '' });",
  "      else this.setState({ volumeCapsError: (result && result.error) || 'The cipher and hash inventory could not be read.' });",
  '    }).catch((error) => this.setState({ volumeCapsError: (error && error.message) || String(error) }));',
  '  }',
  '',
  '  ddDisabledReasons() {',
  '    const caps = this.state.volumeCaps;',
  '    const reasons = { cipher: {}, hash: {} };',
  '    if (caps) {',
  "      (caps.ciphers || []).forEach((c) => { if (!c.available) reasons.cipher[c.id] = c.reason || 'Unavailable in this build.'; });",
  "      (caps.prfs || []).forEach((p) => { if (!p.available) reasons.hash[p.id] = p.reason || 'Unavailable in this build.'; });",
  '    }',
  '    return reasons;',
  '  }',
  '',
  '  // The displayed pool is real: eight bytes drawn from the platform CSPRNG on',
  '  // every stir, xored with the pointer coordinates and arrival time of the',
  '  // movement that triggered it. It seeds nothing — the master key is drawn in',
  '  // the main process — and the copy beside it says exactly that.',
  '  stirEntropy(mouseEvent) {',
  '    if (!window.crypto || !window.crypto.getRandomValues) return;',
  '    const now = Date.now();',
  '    if (mouseEvent && this.lastEntropyMix && now - this.lastEntropyMix < 150) return;',
  '    this.lastEntropyMix = now;',
  '    const bytes = new Uint8Array(8);',
  '    window.crypto.getRandomValues(bytes);',
  '    if (mouseEvent) {',
  '      const mix = [mouseEvent.clientX | 0, mouseEvent.clientY | 0, Math.floor(performance.now())];',
  '      for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= (mix[i % mix.length] >>> ((i % 4) * 8)) & 0xff;',
  '    }',
  "    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');",
  "    this.setState((st) => ({ entropyPool: hex.replace(/(.{4})(?=.)/g, '$1 '), entropyMouseMixes: st.entropyMouseMixes + (mouseEvent ? 1 : 0) }));",
  '  }',
  '',
  '  wizardSizeBytes() {',
  '    const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };',
  '    const amount = Number(String(this.state.volumeSize).trim());',
  '    if (!Number.isFinite(amount) || amount <= 0) return NaN;',
  '    const bytes = Math.floor(amount * (units[this.state.sizeUnit] || 1));',
  '    return bytes - (bytes % 512);',
  '  }',
  '',
  '  async createVolumeNow() {',
  '    if (this.state.wizardBusy) return;',
  '    const api = window.materialEncryption;',
  "    if (!api || typeof api.createVolume !== 'function') { this.setState({ wizardError: 'The volume bridge is unavailable in this build.' }); return; }",
  "    const volume = String(this.state.volumePath || '').trim();",
  "    if (!volume) { this.setState({ wizardError: 'Choose a container path on the Volume Location step first.' }); return; }",
  "    if (!this.state.newPassword) { this.setState({ wizardError: 'Enter a password on the Volume Password step first.' }); return; }",
  '    const sizeBytes = this.wizardSizeBytes();',
  "    if (!Number.isFinite(sizeBytes)) { this.setState({ wizardError: 'Enter the volume size as a number.' }); return; }",
  '    const minimum = this.state.volumeCaps ? this.state.volumeCaps.minimumBytes : 64 * 1024 * 1024;',
  "    if (sizeBytes < minimum) { this.setState({ wizardError: 'This build needs at least ' + this.formatBytes(minimum) + ' for a container, and ' + this.formatBytes(sizeBytes) + ' is smaller than that.' }); return; }",
  "    this.setState({ wizardBusy: true, wizardError: '', wizardResult: null, wizardPhase: 'starting', wizardDone: 0, wizardTotal: 0, wizardStartedAt: Date.now(), wizardElapsedMs: 0, wizardStep: 6 });",
  '    try {',
  '      const result = await api.createVolume({',
  '        volume,',
  '        password: this.state.newPassword,',
  '        sizeBytes,',
  '        cipher: this.state.dd.cipher,',
  '        prf: this.state.dd.hash,',
  '        pim: 0,',
  "        volumeLabel: 'ENCRYPTED',",
  '        filesystem: this.state.dd.filesystem,',
  '        overwrite: false',
  '      });',
  '      if (result && result.ok) {',
  "        this.setState({ wizardResult: result.value, wizardPhase: 'done' });",
  "        this.toast('Volume created', result.value.path + ' · ' + this.formatBytes(result.value.sizeBytes));",
  '      } else {',
  "        this.setState({ wizardError: (result && result.error) || 'The container could not be created.', wizardPhase: '' });",
  '      }',
  '    } catch (error) {',
  "      this.setState({ wizardError: (error && error.message) || String(error), wizardPhase: '' });",
  '    }',
  '    this.setState({ wizardBusy: false });',
  '  }',
  '',
  '  ddOptions() {',
  '    return {'
].join('\n');
html = must(html, '  ddOptions() {\n    return {', wizardMethods, 'wizard engine methods');

html = must(
  html,
  '    this.loadDrives();\n    this.driveTimer = setInterval(() => this.loadDrives(), 5000);\n  }',
  [
    '    this.loadDrives();',
    '    this.driveTimer = setInterval(() => this.loadDrives(), 5000);',
    '    this.loadVolumeCapabilities();',
    '    this.stirEntropy(null);',
    '    this.entropyTimer = setInterval(() => this.stirEntropy(null), 1000);',
    '    this.entropyMouseHandler = (event) => this.stirEntropy(event);',
    "    window.addEventListener('mousemove', this.entropyMouseHandler);",
    "    this.volumeProgressOff = window.materialEncryption && typeof window.materialEncryption.onVolumeCreateProgress === 'function'",
    '      ? window.materialEncryption.onVolumeCreateProgress((progress) => this.setState((st) => ({',
    "          wizardPhase: progress.phase, wizardDone: Number(progress.done) || 0, wizardTotal: Number(progress.total) || 0,",
    '          wizardElapsedMs: st.wizardStartedAt ? Date.now() - st.wizardStartedAt : 0',
    '        })))',
    '      : null;',
    '  }'
  ].join('\n'),
  'wizard mount hooks'
);
html = must(
  html,
  'clearInterval(this.driveTimer); }',
  "clearInterval(this.driveTimer); clearInterval(this.entropyTimer); if (this.entropyMouseHandler) window.removeEventListener('mousemove', this.entropyMouseHandler); if (this.volumeProgressOff) this.volumeProgressOff(); }",
  'wizard teardown'
);

// This build writes FAT32 or leaves the container unformatted; there is no NTFS,
// exFAT or ReFS writer behind those prototype entries.
html = must(
  html,
  "      cipher: ['AES', 'Serpent', 'Twofish', 'Camellia', 'Kuznyechik', 'AES(Twofish)', 'AES(Twofish(Serpent))', 'Serpent(AES)', 'Serpent(Twofish(AES))', 'Twofish(Serpent)', 'Camellia(Kuznyechik)', 'Kuznyechik(Twofish)'],\n" +
  "      hash: ['SHA-512', 'SHA-256', 'Whirlpool', 'BLAKE2s-256', 'Streebog'],\n" +
  "      filesystem: ['NTFS', 'exFAT', 'FAT', 'ReFS', 'None'],",
  "      cipher: this.state.volumeCaps ? this.state.volumeCaps.ciphers.map((c) => c.id) : ['AES', 'Serpent', 'Twofish'],\n" +
  "      hash: this.state.volumeCaps ? this.state.volumeCaps.prfs.map((p) => p.id) : ['HMAC-SHA-512', 'HMAC-SHA-256'],\n" +
  "      filesystem: ['FAT32', 'None'],",
  'wizard engine-backed dropdown options'
);
html = must(
  html,
  "      filesystem: 'NTFS', cluster: 'Default',",
  "      filesystem: 'FAT32', cluster: 'Default',",
  'wizard filesystem default'
);
html = must(
  html,
  "cipher: 'AES', hash: 'SHA-512',",
  "cipher: 'AES', hash: 'HMAC-SHA-512',",
  'wizard hash default'
);

// An unavailable cipher stays visible with the engine's own reason beside it,
// and does nothing when chosen, rather than being offered and then silently
// substituted at creation time.
html = must(
  html,
  "      ddVals['dd_' + id + '_open'] = (e) => this.openMenu(e, this.ddTitles()[id], opts.map(o => [\n" +
  "        o + (s.dd[id] === o ? '  ✓' : ''),\n" +
  '        () => {',
  "      const ddReasons = this.ddDisabledReasons()[id] || {};\n" +
  "      ddVals['dd_' + id + '_open'] = (e) => this.openMenu(e, this.ddTitles()[id], opts.map(o => [\n" +
  "        o + (s.dd[id] === o ? '  ✓' : ''),\n" +
  '        ddReasons[o] ? null : () => {',
  'wizard unavailable dropdown entries'
);
html = must(
  html,
  "          if (id === 'logoFit') this.previewLogoOptions({ ...this.state, logoFit: o });\n        }\n      ]));",
  "          if (id === 'logoFit') this.previewLogoOptions({ ...this.state, logoFit: o });\n        },\n        ddReasons[o] || ''\n      ]));",
  'wizard unavailable dropdown reasons'
);

// Every figure on the format step is derived from the engine's own progress
// events. A value the engine has not reported yet says so instead of guessing.
html = must(
  html,
  '    const themeVars = s.theme === ',
  [
    '    const wizTotal = Number(s.wizardTotal) || 0;',
    '    const wizDone = Number(s.wizardDone) || 0;',
    '    const wizPct = wizTotal > 0 ? Math.min(100, Math.round((wizDone / wizTotal) * 100)) : null;',
    '    const wizElapsedMs = Math.max(0, Number(s.wizardElapsedMs) || 0);',
    "    const wizRate = s.wizardPhase === 'random' && wizDone > 0 && wizElapsedMs > 250 ? wizDone / (wizElapsedMs / 1000) : null;",
    '    const wizEta = wizRate && wizTotal > wizDone ? Math.round((wizTotal - wizDone) / wizRate) : null;',
    "    const wizClock = (total) => String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');",
    '    const wizStatus = s.wizardResult',
    "      ? 'Finished'",
    '      : !s.wizardBusy',
    "        ? 'Not started'",
    "        : s.wizardPhase === 'random'",
    "          ? (wizPct === null ? 'Writing random data · no progress reported yet' : 'Writing random data ' + wizPct + '%')",
    "          : s.wizardPhase === 'filesystem'",
    "            ? 'Writing the FAT32 filesystem'",
    "            : 'Starting · no progress reported yet';",
    '    const wizRateText = s.wizardResult',
    "      ? 'Elapsed ' + wizClock(Math.round(wizElapsedMs / 1000))",
    '      : !s.wizardBusy',
    "        ? 'Not started'",
    '        : wizRate === null',
    "          ? 'Speed not measurable yet'",
    "          : this.formatBytes(wizRate) + '/s · Left ' + (wizEta === null ? 'not known yet' : wizClock(wizEta));",
    '    const wizBarPct = s.wizardResult ? 100 : (wizPct === null ? 0 : wizPct);',
    '',
    '    const themeVars = s.theme === '
  ].join('\n'),
  'wizard measured progress'
);
html = must(
  html,
  "      randomPool: '8F2A C41D 9BE0 3E77',\n" +
  "      formatPct: 63, formatBarStyle: 'height:100%;width:63%;background:var(--p);border-radius:4px',",
  [
    "      randomPool: s.entropyPool || 'Gathering…',",
    "      entropyCopy: 'The Random Pool shows eight bytes drawn from this machine\\u2019s cryptographic random source, redrawn every second and mixed with each pointer movement over this window (' + s.entropyMouseMixes + ' movements mixed so far). Moving the mouse changes the pool you can see; the container\\u2019s master key is drawn separately by the operating system when creation runs, so it does not depend on this.',",
    '      formatStatus: wizStatus,',
    '      formatRate: wizRateText,',
    "      formatBarStyle: 'height:100%;width:' + wizBarPct + '%;background:var(--p);border-radius:4px',",
    '      wizardBusy: s.wizardBusy,',
    "      wizardNextLabel: s.wizardStep < 6 ? 'Next' : (s.wizardBusy ? 'Creating…' : 'Create'),",
    "      wizardNextStyle: 'padding:11px 30px;border-radius:20px;border:0;background:var(--p);color:var(--op);font-weight:500;opacity:' + (s.wizardBusy ? '.6' : '1') + ';cursor:' + (s.wizardBusy ? 'default' : 'pointer'),",
    '      wizardMessage: s.wizardError',
    "        ? 'The container was not created: ' + s.wizardError",
    '        : s.wizardResult',
    "          ? 'Created ' + s.wizardResult.path + ' · ' + this.formatBytes(s.wizardResult.sizeBytes) + ' · ' + s.wizardResult.cipher + ' · ' + s.wizardResult.prf + ' · ' + (s.wizardResult.filesystem === 'None' ? 'unformatted' : s.wizardResult.filesystem)",
    "          : s.volumeCapsError ? 'The cipher and hash inventory could not be read: ' + s.volumeCapsError : '',",
    '      selectNewVolumeTargetPath: async () => {',
    '        const result = await window.materialEncryption.selectNewVolumeTarget();',
    '        if (result && result.ok && result.value) this.setState({ volumePath: result.value });',
    '      },'
  ].join('\n'),
  'wizard measured render values'
);
html = must(
  html,
  '        if (s.wizardStep < 6) this.setState({ wizardStep: s.wizardStep + 1 });\n' +
  '        else if (window.materialEncryption) window.materialEncryption.openNative(\'format\');\n' +
  "        else this.toast('VeraCrypt required', 'Install VeraCrypt to launch its native volume creation wizard.');",
  '        if (s.wizardStep < 6) this.setState({ wizardStep: s.wizardStep + 1 });\n        else this.createVolumeNow();',
  'wizard create action'
);

html = must(
  html,
  '<span>Formatting {{ formatPct }}%</span><span style="font-family:Roboto Mono,monospace">Speed 148 MB/s · Left 00:02:14</span>',
  '<span>{{ formatStatus }}</span><span style="font-family:Roboto Mono,monospace">{{ formatRate }}</span>',
  'wizard progress readout'
);
html = must(
  html,
  '<p style="margin:0;color:var(--onv);font-size:13px;text-wrap:pretty">Move your mouse randomly within this window. The longer you move it, the better the cryptographic strength of the keys.</p>',
  '<p style="margin:0;color:var(--onv);font-size:13px;text-wrap:pretty">{{ entropyCopy }}</p>\n' +
  '                    <sc-if value="{{ wizardMessage }}">\n' +
  '                      <p style="margin:0;padding:14px 16px;border-radius:14px;background:var(--s1);border:1px solid var(--outv);color:var(--on);font-size:13px;text-wrap:pretty">{{ wizardMessage }}</p>\n' +
  '                    </sc-if>',
  'wizard entropy copy and outcome'
);
html = must(
  html,
  '<button onClick="{{ wizardNext }}" style="padding:11px 30px;border-radius:20px;border:0;background:var(--p);color:var(--op);font-weight:500;cursor:pointer">Next</button>',
  '<button onClick="{{ wizardNext }}" disabled="{{ wizardBusy }}" style="{{ wizardNextStyle }}">{{ wizardNextLabel }}</button>',
  'wizard create button'
);
// The prototype's size step named drive F: and 812.44 GB, both invented, on a
// machine that may have no F: at all. The figure now comes from the destination
// the user actually chose, matched against the real drive rows.
html = must(
  html,
  '<p style="margin:0;color:var(--onv);font-size:13px">Free space on drive F: is 812.44 GB.</p>',
  '<p style="margin:0;color:var(--onv);font-size:13px">{{ destinationSpace }}</p>',
  'wizard destination free space readout'
);
html = must(
  html,
  '      volumeSize: s.volumeSize, setVolumeSize: (e) => this.setState({ volumeSize: e.target.value }),',
  [
    '      volumeSize: s.volumeSize, setVolumeSize: (e) => this.setState({ volumeSize: e.target.value }),',
    '      destinationSpace: (() => {',
    "        const target = String(s.volumePath || '').trim();",
    "        if (!target) return 'Choose a destination on the Volume Location step to see its free space.';",
    '        const letter = /^([A-Za-z]):/.exec(target);',
    "        if (!letter) return 'The free space on ' + target + ' could not be matched to a drive letter.';",
    "        const row = (Array.isArray(s.driveRows) ? s.driveRows : []).find((d) => d.letter === letter[1].toUpperCase() + ':');",
    "        if (!row) return 'Drive ' + letter[1].toUpperCase() + ': was not reported by this machine, so its free space is not known.';",
    "        if (!Number.isFinite(row.freeBytes)) return 'Drive ' + row.letter + ' did not report its free space.';",
    '        const wanted = this.wizardSizeBytes();',
    "        const base = 'Free space on drive ' + row.letter + ' is ' + this.formatBytes(row.freeBytes) + '.';",
    '        if (Number.isFinite(wanted) && wanted > row.freeBytes) {',
    "          return base + ' That is less than the ' + this.formatBytes(wanted) + ' container requested, so creation would run out of space.';",
    '        }',
    '        return base;',
    '      })(),'
  ].join('\n'),
  'wizard destination free space'
);
html = must(
  html,
  '<button style="padding:11px 20px;border-radius:20px;border:1px solid var(--outv);background:transparent;color:var(--on);cursor:pointer">Select File…</button>',
  '<button onClick="{{ selectNewVolumeTargetPath }}" style="padding:11px 20px;border-radius:20px;border:1px solid var(--outv);background:transparent;color:var(--on);cursor:pointer">Select File…</button>',
  'wizard container path picker'
);
// The seventh step's own copy still promised the prototype's mouse-driven key
// gathering, which this engine does not do.
html = must(
  html,
  "      'Move the mouse to gather entropy, then the volume is written and formatted.'",
  "      'The container is filled with random data, formatted, and both headers are written. Progress below is reported by the engine as it writes.'",
  'wizard format step copy'
);

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
