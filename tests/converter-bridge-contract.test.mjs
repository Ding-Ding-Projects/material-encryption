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
