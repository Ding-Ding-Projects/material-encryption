import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createConverterService, createPersistentConversionQueue, getFlatFormatRegistry } = require('../src/main/file-converter.cjs');
const root = path.resolve(import.meta.dirname, '..');

test('renderer bridge exposes authoritative queue and exact PDF plan execution seams', async () => {
  const [preload, main, design] = await Promise.all([
    fs.readFile(path.join(root, 'src/main/preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src/main/main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'design/VeraCrypt Material.dc.html'), 'utf8')
  ]);
  for (const name of ['enqueueConverterBatch', 'enqueueConverterFolder', 'getConverterQueue', 'preflightConverterQueue', 'resumeConverterQueue', 'pauseConverterQueue', 'cancelConverterQueue', 'retryConverterQueue']) {
    assert.match(preload, new RegExp(`\\b${name}\\b`), `${name} must be exposed by preload`);
    assert.match(design, new RegExp(`\\b${name}\\b`), `${name} must be used by the renderer`);
  }
  assert.match(preload, /inputTokens\.slice\(offset, offset \+ 128\)/, 'renderer-to-main queue enqueue must be chunked');
  assert.doesNotMatch(design, /runConverterBatch\s*\(/, 'the renderer must not bypass the persistent queue with direct batch execution');
  assert.doesNotMatch(design, /runPdfTool\s*\(/, 'the renderer must execute an already-reviewed PDF token');
  assert.match(design, /executePdfTool\(\{ planToken: s\.pdfPlan\.planToken, confirmOverwrite: false \}\)/);
  assert.match(design, /pdfRotation: 90/);
  assert.match(main, /converterService\.executePdf\(\{ planToken:/);
  assert.match(main, /return converterService\[method\]\(\)/);
  assert.match(await fs.readFile(path.join(root, 'src/main/file-converter.cjs'), 'utf8'), /queueResume\(\).*return queue\.start\(\)/s, 'IPC resume must start work without awaiting the full drain');
});

test('converter, PDF, and Ollama surfaces keep authoritative action and accessibility contracts', async () => {
  const design = await fs.readFile(path.join(root, 'design/VeraCrypt Material.dc.html'), 'utf8');
  for (const marker of [
    'converterPreflightReady',
    's.conversionDestinationToken',
    "value.ready === true",
    "job.status === 'queued' && job.bundled === true",
    'queueSignature: converterQueueSignature',
    'conversionDisabledReason',
    'pdfToolDisabledReason',
    'pdfRunDisabledReason'
  ]) assert.ok(design.includes(marker), `missing authoritative action marker: ${marker}`);
  assert.doesNotMatch(design, /conversionDisabled:[^\n]*!s\.conversionOutput/, 'typed output text must not unlock conversion');
  assert.match(design, /setConversionOutput:[^\n]*conversionDestinationToken: ''[^\n]*conversionPlan: null/, 'typing output text must clear destination authority and the retained plan');

  for (const marker of [
    'aria-label="{{ f.menuLabel }}"',
    'aria-label="{{ model.menuLabel }}"',
    'aria-label="{{ profile.menuLabel }}"',
    'aria-label="{{ ot.menuLabel }}"'
  ]) assert.ok(design.includes(marker), `missing named keyboard action button: ${marker}`);

  assert.match(design, /activateTabFromKey\([\s\S]*ArrowRight:[ ]*1[\s\S]*ArrowLeft:[ ]*-1[\s\S]*event\.key === 'Home'[\s\S]*event\.key === 'End'/);
  for (const panel of ['converter-category-panel', 'pdf-tool-tabpanel', 'ollama-panel-runtime', 'ollama-panel-catalog', 'ollama-panel-cart', 'ollama-panel-chat', 'ollama-panel-harnesses', 'ollama-panel-restore', 'ollama-model-category-panel']) {
    assert.match(design, new RegExp(`id="${panel}"[^>]*role="tabpanel"`), `${panel} must be a stable labelled tab panel`);
  }
  assert.match(design, /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="\{\{ ollamaDownloadPercent \}\}"/);
  assert.match(design, /id="ollama-download-status" role="status" aria-live="polite"/);
  assert.match(design, /ollamaDownloadPercent: Math\.max\(0, Math\.min\(100,/);
  assert.match(design, /@media\(max-width:600px\)[\s\S]*\.regex-editor-row\{grid-template-columns:minmax\(0,1fr\)!important/);
  assert.ok((design.match(/class="regex-editor-row"/g) || []).length >= 4, 'new regex rows must opt into the shared narrow layout');
});

test('persisted queue schema fails closed before malformed jobs can reach preflight or resume', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-invalid-queue-'));
  const statePath = path.join(directory, 'queue.json');
  try {
    await fs.writeFile(statePath, JSON.stringify({ version: 1, paused: false, jobs: [{ id: 'not-a-uuid', sourcePath: 'relative.txt' }] }));
    const queue = createPersistentConversionQueue({ statePath });
    await assert.rejects(queue.snapshot(), (error) => error.code === 'QUEUE_STATE_INVALID');
    await assert.rejects(queue.preflight(), (error) => error.code === 'QUEUE_STATE_INVALID');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('persistent queue preflight refuses empty work and returns bundled capability proof per queued job', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-preflight-proof-'));
  const inputs = path.join(directory, 'inputs');
  const outputs = path.join(directory, 'outputs');
  await fs.mkdir(inputs); await fs.mkdir(outputs);
  const input = path.join(inputs, 'record.json');
  await fs.writeFile(input, '{"ready":true}');
  try {
    const queue = createPersistentConversionQueue({ statePath: path.join(directory, 'queue.json') });
    await assert.rejects(queue.preflight(), (error) => error.code === 'QUEUE_EMPTY');
    const [job] = await queue.enqueue({ paths: [input], destinationRoot: outputs, rule: { targetFormat: 'yaml', group: 'records' } });
    const proof = await queue.preflight();
    assert.equal(proof.ready, true);
    assert.equal(proof.queued, 1);
    assert.deepEqual(proof.jobs, [{ id: job.id, status: 'queued', targetFormat: 'yaml', adapter: 'local', bundled: true }]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('flat registry retains canonical categories, extension arrays, and missing dependency names', () => {
  const registry = getFlatFormatRegistry();
  assert.ok(registry.length > 20);
  assert.deepEqual([...new Set(registry.map((entry) => entry.category))], [
    'Documents/PDF', 'Images', 'Audio', 'Video', 'Archives', 'Structured Data/Spreadsheets', 'Code/Text', 'Binary Encodings'
  ]);
  assert.ok(registry.every((entry) => Array.isArray(entry.extensions) && entry.extensions.every((extension) => extension && !extension.startsWith('.'))));
  assert.ok(registry.filter((entry) => entry.status === 'unavailable').every((entry) => typeof entry.missingDependency === 'string' && entry.missingDependency.length));
});

test('PDF plan capability is exact, single-use, destination-bound for mutations, and bounded', async () => {
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) };
  const service = createConverterService({ dialog });
  await assert.rejects(service.planPdf({ operation: 'merge', inputTokens: [], destinationToken: null }), (error) => error.code === 'INVALID_PDF_INPUTS');
  assert.match(String(service.planPdf), /DESTINATION_REQUIRED/);
  assert.match(String(service.executePdf), /EXPIRED_PDF_PLAN/);
});

test('IPC PDF inputs are not capped at 16 while page, output, and byte bounds remain', async () => {
  const [main, converter] = await Promise.all([
    fs.readFile(path.join(root, 'src/main/main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src/main/file-converter.cjs'), 'utf8')
  ]);
  assert.doesNotMatch(main, /PDF input selection tokens', \{ maxItems: 16 \}/);
  assert.doesNotMatch(converter, /MAX_PDF_INPUTS/);
  assert.match(converter, /MAX_PDF_AGGREGATE_INPUT_BYTES/);
  assert.match(converter, /MAX_PDF_PAGES = 512/);
  assert.match(converter, /MAX_PDF_OUTPUTS = 512/);
});
