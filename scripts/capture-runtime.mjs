import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import WebSocket from 'ws';

const args = new Map(process.argv.slice(2).map((part) => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const port = Number(args.get('port'));
const state = args.get('state');
const output = args.get('output');
const destinations = {
  volumes: ['Volumes', 'Volumes'], favorites: ['Favorites', 'Favorite Volumes'], create: ['Create', 'Volume Creation Wizard'],
  properties: ['Properties', 'Volume Properties'], security: ['Security', 'Security'], tools: ['Tools', 'Performance & Tools'],
  converter: ['Converter', 'File Converter'], preferences: ['Preferences', 'Preferences'], history: ['History', 'History'],
  locks: ['Locks', 'Locked surfaces'], auth: ['Authenticator', 'Authenticator'], support: ['Support', 'Support Tickets'], settings: ['Settings', 'Settings']
};
const fixtureLabel = 'Seeded visual fixture — not live service proof';
const fixtureModels = [
  {
    id: 'fixture-qwen3-4b-q4', name: 'Fixture Qwen', model: 'Fixture Qwen', tag: '4b-q4_K_M', family: 'qwen-fixture', category: 'Chat',
    capabilities: ['chat', 'text'], sizeBytes: 2800000000, parameters: '4B', quantization: 'Q4_K_M', installed: true, available: true,
    description: 'Deterministic catalog fixture for a small installed chat model.', fit: 'Runs well', contextLength: 8192,
    fitEvidence: { ram: '16 GB detected / 5.1 GB required', vram: '8 GB detected / 3.2 GB required', driver: 'Fixture driver supports acceleration', freeDisk: '96 GB', modelBytes: '2.8 GB', contextOverhead: '1.2 GB', caveat: 'Evidence is seeded for visual coverage only.' }
  },
  {
    id: 'fixture-gemma-12b-q4', name: 'Fixture Gemma', model: 'Fixture Gemma', tag: '12b-q4_K_M', family: 'gemma-fixture', category: 'Chat',
    capabilities: ['chat', 'text'], sizeBytes: 7600000000, parameters: '12B', quantization: 'Q4_K_M', installed: false, available: true,
    description: 'Deterministic catalog fixture for a constrained local model.', fit: 'Runs with limits',
    fitEvidence: { ram: '16 GB detected / 12.4 GB required', vram: '8 GB detected / 8.9 GB preferred', driver: 'Fixture driver supports partial offload', freeDisk: '96 GB', modelBytes: '7.6 GB', contextOverhead: '2.4 GB', caveat: 'Reduced context or CPU spill may be required.' }
  },
  {
    id: 'fixture-vision-32b-q5', name: 'Fixture Vision', model: 'Fixture Vision', tag: '32b-q5_K_M', family: 'vision-fixture', category: 'Vision',
    capabilities: ['vision', 'chat'], sizeBytes: 22400000000, parameters: '32B', quantization: 'Q5_K_M', installed: false, available: true,
    description: 'Deterministic catalog fixture for an oversized vision model.', fit: 'Unlikely',
    fitEvidence: { ram: '16 GB detected / 30 GB required', vram: '8 GB detected / 24 GB preferred', driver: 'Fixture driver supports acceleration', freeDisk: '96 GB', modelBytes: '22.4 GB', contextOverhead: '6.8 GB', caveat: 'Required working memory exceeds the fixture PC evidence.' }
  },
  {
    id: 'fixture-unknown-latest', name: 'Fixture Unknown', model: 'Fixture Unknown', tag: 'latest', family: 'unknown-fixture', category: 'Other',
    capabilities: [], parameters: 'Unknown', quantization: 'Unknown', installed: false, available: false,
    unavailableReason: 'Exact model bytes and hardware requirements were not reported.', description: 'Deterministic catalog fixture with deliberately incomplete evidence.', fit: 'Unknown',
    fitEvidence: { ram: 'Not reported', vram: 'Not reported', driver: 'Not reported', freeDisk: '96 GB', modelBytes: 'Not reported', contextOverhead: 'Not reported', caveat: 'No fit verdict is guessed without complete evidence.' }
  }
];
const fixtureFormats = [
  { id: 'pdf', label: 'PDF', category: 'Documents/PDF', extensions: ['pdf'], available: true, adapter: 'bundled-pdf', description: 'Bundled local inspect and mutation adapter.' },
  { id: 'docx', label: 'Word document', category: 'Documents/PDF', extensions: ['docx'], available: false, adapter: 'document-adapter', missingDependency: 'document-adapter', reason: 'The packaged artifact does not include the document adapter.' },
  { id: 'txt', label: 'Plain text', category: 'Documents/PDF', extensions: ['txt'], available: true, adapter: 'bundled-text', description: 'Bundled local text adapter.' }
];
const fixtureQueue = [
  { id: 'fixture-job-queued', inputName: 'queued-report.pdf', name: 'queued-report.pdf', targetFormat: 'pdf', type: 'pdf', size: '1.2 MB', status: 'queued' },
  { id: 'fixture-job-running', inputName: 'running-notes.txt', name: 'running-notes.txt', targetFormat: 'pdf', type: 'text', size: '84 KB', status: 'running' },
  { id: 'fixture-job-done', inputName: 'finished-guide.txt', name: 'finished-guide.txt', targetFormat: 'pdf', type: 'text', size: '42 KB', status: 'converted', outputName: 'finished-guide.pdf', outputBytes: 93000 },
  { id: 'fixture-job-failed', inputName: 'failed-archive.zip', name: 'failed-archive.zip', targetFormat: 'pdf', type: 'archive', size: '4.3 MB', status: 'failed' },
  { id: 'fixture-job-cancelled', inputName: 'cancelled-video.mp4', name: 'cancelled-video.mp4', targetFormat: 'pdf', type: 'video', size: '81 MB', status: 'cancelled' }
];
const fixtureOutcomes = [
  { entry: fixtureQueue[2], status: 'converted', detail: 'finished-guide.pdf · 93000 B' },
  { entry: fixtureQueue[3], status: 'failed', detail: 'Unsupported source signature; the source remains unchanged.' },
  { entry: fixtureQueue[4], status: 'cancelled', detail: 'Cancellation persisted before restart; retry remains explicit.' }
];
const fixtureHarnesses = [
  { id: 'fixture-harness-code', name: 'Fixture Coding Harness', description: 'Reviewed local coding profile with allowlisted arguments.', executable: 'reviewed-coding-harness.exe', profile: 'local-code', changes: ['model=Fixture Qwen', 'context=8192'], preflight: { summary: 'Executable, model and destination are ready.' }, ready: true },
  { id: 'fixture-harness-vision', name: 'Fixture Vision Harness', description: 'Reviewed vision profile whose required model is not installed.', executable: 'reviewed-vision-harness.exe', profile: 'local-vision', changes: ['model=Fixture Vision'], preflight: { summary: 'Fixture Vision must be installed before launch.' }, ready: false, reason: 'Required model is not installed.' }
];
const fixtureSnapshots = [
  { id: 'fixture-snapshot-ready', profileName: 'Fixture Coding Harness', status: 'ready', restorable: true, changes: ['model restored to previous value', 'context restored to 4096'] },
  { id: 'fixture-snapshot-held', profileName: 'Fixture Vision Harness', status: 'incomplete', restorable: false, changes: ['No changes were applied'] }
];
const baseOllamaPatch = {
  ollamaHealth: { version: '0.11.4-fixture' }, ollamaModels: fixtureModels,
  ollamaCatalogMeta: { revision: 'fixture-catalog-r7', refreshedAt: '2030-01-02T03:04:05.000Z', stale: false, source: 'Seeded capture fixture' },
  ollamaRefreshing: false, ollamaLastError: '', ollamaHarnessProfiles: fixtureHarnesses, ollamaHarnessSnapshots: fixtureSnapshots, ollamaHarnessLoading: false
};
const fixtures = {
  'converter-catalog': {
    view: 'converter', selector: '#converter-format-catalog', scopeSelector: '#converter-format-catalog', headingSelector: '#converter-format-catalog h2', heading: 'Conversion format catalog',
    markers: ['Documents/PDF', 'PDF', 'Available', 'Word document', 'Unavailable', 'document-adapter'],
    counts: [{ selector: '#converter-category-panel button[aria-label]', count: 3, label: 'format cards' }],
    patch: { converterRegistry: fixtureFormats, converterRegistryLoading: false, converterCategory: 'Documents/PDF', conversionTarget: 'pdf' }
  },
  'pdf-tools': {
    view: 'converter', selector: '#pdf-tools-panel', scopeSelector: '#pdf-tools-panel', headingSelector: '#pdf-tools-panel h2', heading: 'PDF Tools',
    markers: ['Inspect', 'Split', 'Merge', 'Extract pages', 'Reorder', 'Rotate', 'Edit metadata', 'PDF rotate plan ready'],
    counts: [{ selector: '#pdf-tools-panel [role="tab"]', count: 7, label: 'PDF actions' }],
    patch: { converterRegistry: fixtureFormats, conversionQueue: [fixtureQueue[0]], conversionPdfInputTokens: ['fixture-pdf-token'], conversionDestinationToken: 'fixture-destination-token', conversionOutput: 'Fixture output folder', pdfAction: 'rotate', pdfRanges: '1-3', pdfRotation: 90, pdfPlan: { supported: true, planToken: 'fixture-pdf-plan', operation: 'rotate', summary: 'PDF rotate plan ready', detail: 'queued-report.pdf · pages 1-3 · 90° clockwise' } }
  },
  'converter-bulk-queue': {
    view: 'converter', selector: '[aria-label="Virtualized conversion queue"]', scopeSelector: '.converter-layout section', headingSelector: '.converter-layout section h2', heading: 'Source files',
    markers: ['5 queued', 'queued-report.pdf', 'running-notes.txt', 'finished-guide.txt', 'failed-archive.zip', 'cancelled-video.mp4'],
    counts: [{ selector: '[aria-label="Virtualized conversion queue"] > div', count: 5, label: 'queue rows' }],
    patch: { converterRegistry: fixtureFormats, conversionQueue: fixtureQueue, bulkOutcomeRows: fixtureOutcomes, bulkPaused: false, bulkWorkerLimit: 2, bulkResumeDetail: 'Seeded bounded queue snapshot with explicit per-file outcomes.' }
  },
  'converter-recovery': {
    view: 'converter', selector: '[aria-label="Virtualized conversion queue"]', scopeSelector: '.converter-layout section', headingSelector: '.converter-layout section h2', heading: 'Source files',
    markers: ['Retry failed', 'Export outcomes', 'failed-archive.zip', 'cancelled-video.mp4', 'Restart recovery fixture'],
    counts: [{ selector: '[aria-label="Virtualized conversion queue"] > div', count: 5, label: 'recovery queue rows' }],
    patch: { converterRegistry: fixtureFormats, conversionQueue: fixtureQueue, bulkOutcomeRows: fixtureOutcomes, bulkPaused: true, bulkResumeDetail: 'Restart recovery fixture: failed and cancelled jobs remain paused until an explicit retry.' }
  },
  'ollama-runtime': {
    view: 'ollama', selector: '[aria-label="Ollama Studio sections"]', scopeSelector: 'main', headingSelector: 'main h2', heading: 'Guided runtime setup',
    markers: ['Local runtime detected', '0.11.4-fixture', 'fixture-catalog-r7', '4', 'Model recommendation wizard', 'Troubleshooter'],
    patch: { ...baseOllamaPatch, ollamaTab: 'runtime' }
  },
  'model-catalog': {
    view: 'ollama', selector: '[aria-label="Model Store filters"]', scopeSelector: 'main', headingSelector: 'main h1', heading: 'Ollama Studio',
    markers: ['4 total runtime-reported variants', 'Fixture Qwen', 'Fixture Gemma', 'Fixture Vision', 'Fixture Unknown', 'fixture-catalog-r7'],
    counts: [{ selector: '.ollama-model-grid > article', count: 4, label: 'catalog variant cards' }],
    patch: { ...baseOllamaPatch, ollamaTab: 'catalog', ollamaModelCategory: 'All', ollamaFitFilter: 'All fits' }
  },
  'model-pc-fit': {
    view: 'ollama', selector: '.ollama-model-grid', scopeSelector: 'main', headingSelector: 'main h1', heading: 'Ollama Studio',
    markers: ['Fixture Qwen', 'Fixture Gemma', 'Fixture Vision', 'Fixture Unknown', 'Runs well', 'Runs with limits', 'Unlikely', 'Unknown', '16 GB detected / 5.1 GB required', 'No fit verdict is guessed without complete evidence.'],
    counts: [{ selector: '.ollama-model-grid > article', count: 4, label: 'fit-evidence cards' }, { selector: '.ollama-model-grid details[open]', count: 4, label: 'expanded fit-evidence panels' }],
    patch: { ...baseOllamaPatch, ollamaTab: 'catalog', ollamaModelCategory: 'All', ollamaFitFilter: 'All fits' }, openDetails: true
  },
  'download-cart': {
    view: 'ollama', selector: '[aria-label="Ollama Studio sections"]', scopeSelector: 'main', headingSelector: 'main h2', heading: 'Download all models',
    markers: ['$0 — no purchase.', 'Fixture Gemma · 12b-q4_K_M', 'Fixture Vision · 32b-q5_K_M', 'Storage preflight', 'Per-model outcomes', '62% seeded fixture progress'],
    stateIds: { path: 'ollamaCart', expected: ['fixture-gemma-12b-q4', 'fixture-vision-32b-q5'] },
    patch: { ...baseOllamaPatch, ollamaTab: 'cart', ollamaCart: ['fixture-gemma-12b-q4', 'fixture-vision-32b-q5'], ollamaDownloadPercent: 62, ollamaDownloadStatus: '62% seeded fixture progress — no download was started.', ollamaDownloadOutcomes: [{ key: 'fixture-gemma-12b-q4', name: 'Fixture Gemma', status: 'Completed', detail: 'Seeded outcome only.', color: 'var(--ok)' }, { key: 'fixture-vision-32b-q5', name: 'Fixture Vision', status: 'Failed', detail: 'Seeded network interruption outcome.', color: 'var(--err)' }] }
  },
  chat: {
    view: 'ollama', selector: '[aria-label="Completed chat transcript"]', scopeSelector: 'main', headingSelector: 'main h2', heading: 'Conversations',
    markers: ['Fixture local chat', 'Show the evidence boundary.', 'This is a seeded transcript, not a live model response.', 'Suggested defaults', 'Fixture Qwen · 4b-q4_K_M'],
    counts: [{ selector: '[aria-label="Completed chat transcript"] > div', count: 2, label: 'chat messages' }],
    patch: { ...baseOllamaPatch, ollamaTab: 'chat', ollamaChatModel: 'fixture-qwen3-4b-q4', ollamaConversations: [{ id: 'fixture-chat', title: 'Fixture local chat', messages: [{ role: 'user', content: 'Show the evidence boundary.' }, { role: 'assistant', content: 'This is a seeded transcript, not a live model response.' }] }], ollamaActiveConversation: 'fixture-chat', ollamaChatStatus: 'Seeded visual transcript; no request was sent.' }
  },
  harnesses: {
    view: 'ollama', selector: '[aria-label="Search harness profiles"]', scopeSelector: 'main', headingSelector: 'main h1', heading: 'Ollama Studio',
    markers: ['Fixture Coding Harness', 'Ready', 'Fixture Vision Harness', 'Unavailable', 'reviewed-coding-harness.exe', 'There is deliberately no arbitrary command box'],
    counts: [{ selector: 'main article', count: 2, label: 'harness profile cards' }],
    patch: { ...baseOllamaPatch, ollamaTab: 'harnesses', ollamaHarnessStatus: 'Seeded profiles for visual coverage; no harness was launched.' }
  },
  restore: {
    view: 'ollama', selector: '[aria-label="Ollama Studio sections"]', scopeSelector: 'main', headingSelector: 'main h2', heading: 'Snapshots and one-click restore',
    markers: ['Fixture Coding Harness', 'fixture-snapshot-ready', 'Fixture Vision Harness', 'fixture-snapshot-held', 'Restore status', 'Seeded snapshots for visual coverage'],
    stateIds: { path: 'ollamaHarnessSnapshots', key: 'id', expected: ['fixture-snapshot-ready', 'fixture-snapshot-held'] },
    patch: { ...baseOllamaPatch, ollamaTab: 'restore', ollamaHarnessStatus: 'Seeded snapshots for visual coverage; no restore was attempted.' }
  }
};
const specialStates = new Set(['logo', 'light', 'narrow', 'palette', 'regex', 'appearance', 'confirm', 'menu', 'lock-wizard', 'navigator', 'error', 'ollama-offline', ...Object.keys(fixtures)]);
if (!Number.isInteger(port) || (!destinations[state] && !specialStates.has(state)) || !output) {
  throw new Error('Usage: node scripts/capture-runtime.mjs --port=9339 --state=<destination|special-state> --output=path.png');
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (targets.length !== 1 || targets[0].type !== 'page' || !targets[0].url.includes('/resources/app.asar/src/renderer/index.html') || !targets[0].webSocketDebuggerUrl) {
  throw new Error('Runtime isolation failed: expected exactly one packaged renderer page.');
}

const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let sequence = 0;
const pending = new Map();
socket.on('message', (data) => {
  const response = JSON.parse(data.toString());
  if (!response.id || !pending.has(response.id)) return;
  const { resolve, reject } = pending.get(response.id); pending.delete(response.id);
  if (response.error) reject(new Error(response.error.message)); else resolve(response.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, options = {}) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, ...options });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

const visibleElementExpression = (selector) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
})()`;
const visibleExactTextExpression = (selector, value) => `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].some((element) => {
  const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight && element.innerText.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(value)};
}))()`;
const visibleContainsTextExpression = (selector, value) => `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].some((element) => {
  const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight && element.innerText.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(value)});
}))()`;
const visibleAttributeExpression = (selector, attribute, value) => `(() => [...document.querySelectorAll(${JSON.stringify(selector)})].some((element) => {
  const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight && element.getAttribute(${JSON.stringify(attribute)}) === ${JSON.stringify(value)};
}))()`;

async function waitFor(expression, description, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    if (attempt === attempts - 1) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function clickText(text, selector = 'button') {
  const clicked = await evaluate(`(() => {
    const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'; };
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => visible(candidate) && (candidate.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} || candidate.getAttribute('title') === ${JSON.stringify(text)}));
    if (!element) return false; element.click(); return true;
  })()`);
  if (!clicked) throw new Error(`Could not activate ${text}.`);
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function go(destination) {
  const [railLabel, expectedTitle] = destinations[destination];
  await clickText(railLabel, 'nav.app-rail button');
  await waitFor(`document.querySelector('h1')?.textContent.trim() === ${JSON.stringify(expectedTitle)}`, `${destination} heading`);
  await evaluate(`(() => { const main = document.querySelector('main'); for (const element of [main, ...document.querySelectorAll('main *')]) { if (element.scrollHeight > element.clientHeight) element.scrollTop = 0; } window.scrollTo(0, 0); return true; })()`);
  return expectedTitle;
}

const findLogicSource = `() => {
  for (const node of document.querySelectorAll('#dc-root, #dc-root *')) {
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    let fiber = key ? node[key] : null;
    const seen = new Set();
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      if (fiber.stateNode?.logic?.state && typeof fiber.stateNode.logic.setState === 'function') return fiber.stateNode.logic;
      fiber = fiber.return;
    }
  }
  return null;
}`;

async function injectFixture(name, fixture) {
  if (fixture.view === 'ollama') {
    await waitFor(`(() => { const logic = (${findLogicSource})(); return logic && logic.state.ollamaRefreshing === false && logic.state.ollamaHarnessLoading === false; })()`, 'initial Ollama bridge requests to settle');
  } else {
    await waitFor(`(() => { const logic = (${findLogicSource})(); return logic && logic.state.converterRegistryLoading === false; })()`, 'initial converter registry request to settle');
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  const patch = { ...fixture.patch, view: fixture.view, __captureFixture: { schemaVersion: 1, id: name, label: fixtureLabel } };
  const result = await evaluate(`(() => {
    const logic = (${findLogicSource})();
    if (!logic) return { ok: false, reason: 'Mounted renderer logic was not found.' };
    if (logic.converterQueueTimer) { clearInterval(logic.converterQueueTimer); logic.converterQueueTimer = null; }
    logic.setState(${JSON.stringify(patch)});
    window.__materialEncryptionCaptureFixture = ${JSON.stringify({ schemaVersion: 1, id: name, label: fixtureLabel })};
    let badge = document.querySelector('[data-capture-fixture-label]');
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('data-capture-fixture-label', '');
      Object.assign(badge.style, { position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483647', maxWidth: '360px', padding: '9px 13px', borderRadius: '14px', background: '#f9dedc', color: '#8c1d18', border: '1px solid #f2b8b5', font: '500 12px/16px Roboto, Arial, sans-serif', boxShadow: '0 3px 10px #0006', pointerEvents: 'none' });
      document.body.appendChild(badge);
    }
    badge.textContent = ${JSON.stringify(fixtureLabel)};
    return { ok: true, id: logic.state.__captureFixture?.id || null };
  })()`);
  if (!result?.ok) throw new Error(`Fixture ${name} was not injected: ${result?.reason || 'unknown reason'}`);
  await waitFor(`(() => { const logic = (${findLogicSource})(); return logic?.state?.__captureFixture?.id === ${JSON.stringify(name)}; })()`, `${name} fixture acknowledgement`);
  await waitFor(`(() => [...document.querySelectorAll(${JSON.stringify(fixture.headingSelector)})].some((element) => element.innerText.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(fixture.heading)}))()`, `${name} exact heading`);
  if (fixture.openDetails) {
    await waitFor(`document.querySelectorAll('.ollama-model-grid > article').length === 4`, 'four model fit cards');
    const expanded = await evaluate(`(() => { const details = [...document.querySelectorAll('.ollama-model-grid details')]; details.forEach((element) => { element.open = true; }); return details.length; })()`);
    if (expanded !== 4) throw new Error(`Fixture ${name} rendered ${expanded} fit-evidence panels, expected 4.`);
  }
  const selected = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(fixture.selector)}); if (!element) return false; element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; })()`);
  if (!selected) throw new Error(`Fixture ${name} did not render its target ${fixture.selector}.`);
  await waitFor(visibleElementExpression(fixture.selector), `${name} visible target surface`);
  await waitFor(visibleExactTextExpression(fixture.headingSelector, fixture.heading), `${name} exact visible heading`);
  for (const assertion of fixture.counts || []) {
    await waitFor(`document.querySelectorAll(${JSON.stringify(assertion.selector)}).length === ${assertion.count}`, `${assertion.count} ${assertion.label}`);
  }
  if (fixture.stateIds) {
    const ids = await evaluate(`(() => { const logic = (${findLogicSource})(); const value = logic?.state?.[${JSON.stringify(fixture.stateIds.path)}]; return Array.isArray(value) ? value.map((entry) => ${fixture.stateIds.key ? `String(entry?.[${JSON.stringify(fixture.stateIds.key)}])` : 'String(entry)'}) : []; })()`);
    if (JSON.stringify(ids) !== JSON.stringify(fixture.stateIds.expected)) throw new Error(`Fixture ${name} rendered the wrong exhaustive state ID set: ${JSON.stringify(ids)}`);
  }
  return fixture.heading;
}

await command('Page.reload', { ignoreCache: true });
await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('h1'))`, 'packaged renderer readiness');
await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await evaluate(`(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; window.scrollTo(0, 0); const root = document.querySelector('.theme-root'); if (root) root.scrollTop = 0; return true; })()`);
let expected = destinations[state]?.[1] || state;
let surfaceExpression = visibleExactTextExpression('main h1', destinations[state]?.[1] || '');
let surfaceDescription = `${destinations[state]?.[1] || state} exact visible page heading`;
let markerScopeSelector = 'main';
let evidenceKind = 'packaged-runtime-ui';
let evidenceLabel = 'Real packaged renderer UI interaction; no claim about external files or services.';
let markers = [];
if (destinations[state]) await go(state);
if (state === 'logo') { await go('settings'); await clickText('App logo'); expected = 'App logo customizer'; surfaceExpression = visibleExactTextExpression('main h2', 'App logo customizer'); surfaceDescription = 'App logo customizer exact visible heading'; markers = ['App logo customizer']; }
if (state === 'light') {
  await go('settings'); await clickText('Appearance & language'); await clickText('Light');
  const background = await evaluate(`getComputedStyle(document.querySelector('header').parentElement).backgroundColor`);
  if (background !== 'rgb(255, 255, 255)') throw new Error(`Light theme did not render its expected surface role: ${background}`);
  expected = 'Settings · light theme'; surfaceExpression = visibleExactTextExpression('main h1', 'Settings'); surfaceDescription = 'Settings exact visible heading in light theme'; markers = ['Appearance & language'];
}
if (state === 'narrow') { await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await go('converter'); expected = 'File Converter · 390px'; surfaceExpression = visibleExactTextExpression('main h1', 'File Converter'); surfaceDescription = 'File Converter exact visible heading at 390px'; markers = ['File Converter']; }
if (state === 'palette') {
  const opened = await evaluate(`(() => { const logic = (${findLogicSource})(); if (!logic) return false; logic.setState({ dialog: 'palette', paletteQuery: '' }); return true; })()`);
  if (!opened) throw new Error('The mounted renderer logic could not open the command palette.');
  await waitFor(`(() => { const logic = (${findLogicSource})(); if (!logic) return false; logic.setState({ paletteQuery: 'Ollama Studio' }); return true; })()`, 'command palette query state');
  expected = 'Command palette'; surfaceExpression = visibleAttributeExpression('input', 'placeholder', 'Jump to a surface, setting or action'); surfaceDescription = 'command palette input with its exact visible placeholder'; markerScopeSelector = 'body'; markers = ['Ollama Studio — local runtime onboarding'];
}
if (state === 'regex') { await go('volumes'); await clickText('.*'); expected = 'Regex builder'; surfaceExpression = visibleExactTextExpression('h2', 'Regex builder'); surfaceDescription = 'Regex builder exact visible heading'; markerScopeSelector = 'body'; markers = ['Regex builder']; }
if (state === 'appearance') { await go('volumes'); await clickText('Appearance'); expected = 'Edit appearance'; surfaceExpression = visibleExactTextExpression('h2', 'Edit appearance'); surfaceDescription = 'Edit appearance exact visible heading'; markerScopeSelector = 'body'; markers = ['Edit appearance']; }
if (state === 'confirm') { await go('volumes'); await clickText('Wipe Cache'); expected = 'Super confirmation'; surfaceExpression = visibleContainsTextExpression('h2', 'Wipe password cache'); surfaceDescription = 'super-confirmation exact action heading'; markerScopeSelector = 'body'; markers = ['Wipe password cache']; }
if (state === 'error') {
  await go('volumes');
  const opened = await evaluate(`(() => { const logic = (${findLogicSource})(); if (!logic) return false; logic.setState({ volumePath: '' }); logic.toast('Choose a volume', 'Select a volume file or device before opening VeraCrypt.'); return true; })()`);
  if (!opened) throw new Error('The mounted renderer logic could not present the safe notification fixture.');
  expected = 'Choose a volume notification'; surfaceExpression = visibleExactTextExpression('body b', 'Choose a volume'); surfaceDescription = 'safe Choose a volume notification'; markerScopeSelector = 'body'; markers = ['Choose a volume', 'Select a volume file or device before opening VeraCrypt.'];
}
if (state === 'menu' || state === 'lock-wizard') {
  await go('volumes');
  await evaluate(`document.querySelectorAll('.toy-layer').forEach((element) => element.remove())`);
  const opened = await evaluate(`(() => { const target = [...document.querySelectorAll('h1,h2')].find((element) => element.textContent.trim() === 'Volumes'); if (!target?.dataset.toyLockId) return false; window.dispatchEvent(new CustomEvent('material-encryption-element-menu', { detail: { targetId: target.dataset.toyLockId } })); return true; })()`);
  if (!opened) throw new Error('The Volumes heading was unavailable for exact-element context menu capture.');
  expected = 'Exact-element context menu'; surfaceExpression = visibleContainsTextExpression('.toy-menu .toy-eyebrow', 'ELEMENT ACTIONS'); surfaceDescription = 'exact-element context menu'; markerScopeSelector = 'body'; markers = ['Lock this element'];
}
if (state === 'lock-wizard') {
  const opened = await evaluate(`(() => {
    const action = [...document.querySelectorAll('.toy-menu-action')].find((element) => element.textContent.includes('Lock this element'));
    if (!action) return false; action.click(); return Boolean(document.querySelector('.toy-wizard'));
  })()`);
  if (!opened) throw new Error('The exact-element lock wizard did not open.');
  expected = 'Exact-element lock wizard'; surfaceExpression = visibleContainsTextExpression('.toy-wizard .toy-eyebrow', 'LOCK WIZARD · STEP 1 OF 4'); surfaceDescription = 'exact-element lock wizard step 1'; markerScopeSelector = 'body'; markers = ['LOCK WIZARD · STEP 1 OF 4'];
}
if (state === 'navigator') {
  const opened = await evaluate(`(() => {
    const registered = getEventListeners(document).keydown || [];
    const handler = registered.map((entry) => entry.listener).find((listener) => String(listener).includes('openElementNavigator'));
    if (typeof handler !== 'function') return false;
    handler({ key: 'l', ctrlKey: true, altKey: true, shiftKey: false, target: document.body, preventDefault() {} });
    return true;
  })()`, { includeCommandLineAPI: true });
  if (!opened) throw new Error('The packaged bridge navigator action was not registered.');
  expected = 'Keyboard element navigator'; surfaceExpression = visibleAttributeExpression('[role="dialog"]', 'aria-label', 'Choose an element to lock'); surfaceDescription = 'keyboard element navigator dialog'; markerScopeSelector = 'body'; markers = ['KEYBOARD ELEMENT NAVIGATOR', 'Choose an exact rendered element'];
}
if (state === 'ollama-offline') {
  await clickText('Ollama Studio', 'nav.app-rail button');
  await waitFor(`(() => { const logic = (${findLogicSource})(); return logic && logic.state.ollamaRefreshing === false; })()`, 'actual Ollama bridge/runtime result');
  const actual = await evaluate(`(() => { const logic = (${findLogicSource})(); return { health: logic?.state?.ollamaHealth || null, error: logic?.state?.ollamaLastError || '', statusTitle: document.querySelector('[role="status"] b')?.textContent.trim() || '' }; })()`);
  if (!['Ollama bridge unavailable — actions are closed', 'Local runtime not detected', 'Local runtime detected', 'Runtime detected · catalog is stale/offline'].includes(actual?.statusTitle)) throw new Error(`The live Ollama state was not one of the honest packaged bridge/runtime states: ${JSON.stringify(actual)}`);
  const runtimeDetected = Boolean(actual?.health);
  expected = runtimeDetected ? 'Ollama local runtime observation' : 'Ollama offline recovery'; surfaceExpression = visibleExactTextExpression('main h1', 'Ollama Studio'); surfaceDescription = 'Ollama Studio exact visible heading with actual bridge/runtime state'; markers = runtimeDetected ? [actual.statusTitle, 'Local runtime facts', actual.health.version || 'Healthy; version not reported'] : [actual.statusTitle, 'Offline help', 'Start local runtime'];
  evidenceKind = 'actual-bridge-runtime-observation';
  evidenceLabel = runtimeDetected ? 'Actual packaged local-runtime observation.' : (actual.statusTitle === 'Ollama bridge unavailable — actions are closed' ? 'Actual packaged bridge-unavailable state.' : 'Actual packaged local-runtime-offline state.');
}
if (fixtures[state]) {
  await clickText(fixtures[state].view === 'ollama' ? 'Ollama Studio' : 'Converter', 'nav.app-rail button');
  expected = await injectFixture(state, fixtures[state]);
  surfaceExpression = `${visibleElementExpression(fixtures[state].selector)} && ${visibleExactTextExpression(fixtures[state].headingSelector, fixtures[state].heading)}`;
  surfaceDescription = `${state} visible target and exact heading`;
  markerScopeSelector = fixtures[state].scopeSelector;
  markers = [...fixtures[state].markers, fixtureLabel];
  evidenceKind = 'seeded-visual-fixture';
  evidenceLabel = fixtureLabel;
}

await new Promise((resolve) => setTimeout(resolve, 180));
const headingEvidence = await evaluate(`(() => [...document.querySelectorAll('h1,h2,h3')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).map((element) => element.textContent.replace(/\\s+/g, ' ').trim()).filter(Boolean))()`);
await waitFor(surfaceExpression, surfaceDescription);
const missingMarkers = await evaluate(`(() => { const text = (document.querySelector(${JSON.stringify(markerScopeSelector)})?.innerText || '').replace(/\\s+/g, ' '); return ${JSON.stringify(markers.filter((marker) => marker !== fixtureLabel))}.filter((marker) => !text.includes(marker)); })()`);
if (missingMarkers.length) throw new Error(`State ${state} is missing expected marker(s): ${missingMarkers.join(', ')}`);
if (fixtures[state]) {
  const fixtureBadgeVisible = await evaluate(`(() => { const element = document.querySelector('[data-capture-fixture-label]'); if (!element || element.innerText !== ${JSON.stringify(fixtureLabel)}) return false; const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })()`);
  if (!fixtureBadgeVisible) throw new Error(`Fixture ${state} did not keep its evidence-boundary badge visible in frame.`);
}
const logo = await evaluate(`(() => { const image = document.querySelector('header img[alt="Material Encryption app logo"]'); if (!image || !image.complete || image.naturalWidth < 16) return false; const rect = image.getBoundingClientRect(); const style = getComputedStyle(image); return rect.width >= 16 && rect.height >= 16 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0; })()`);
if (!logo) throw new Error('The application logo did not render in the packaged artifact.');
const horizontalOverflow = await evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
if (horizontalOverflow) {
  const overflow = await evaluate(`(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')]
      .map((element) => { const rect = element.getBoundingClientRect(); return { tag: element.tagName.toLowerCase(), cls: element.className || '', text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), scrollWidth: element.scrollWidth }; })
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8)
  }))()`);
  throw new Error(`State ${state} has horizontal page overflow: ${JSON.stringify(overflow)}`);
}
const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const bytes = Buffer.from(capture.data, 'base64');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('Runtime capture does not have a valid PNG signature and IHDR.');
const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
const expectedSize = state === 'narrow' ? [390, 844] : [1440, 900];
if (width !== expectedSize[0] || height !== expectedSize[1]) throw new Error(`${state} captured at ${width}x${height}, expected ${expectedSize.join('x')}.`);
await writeFile(output, bytes);
socket.close();
console.log(JSON.stringify({ state, expected, output, width, height, logo: true, horizontalOverflow: false, headings: headingEvidence, markers, evidenceKind, evidenceLabel, fixtureSchemaVersion: fixtures[state] ? 1 : null, fixtureId: fixtures[state] ? state : null, target: targets[0].url }));
