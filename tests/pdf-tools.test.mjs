import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PDFDocument, degrees } = require('pdf-lib');
const {
  executePdfOperation,
  getFormatRegistry,
  inspectPdfBuffer,
  createPersistentConversionQueue,
  writePdfAtomic
} = require('../src/main/file-converter.cjs');

async function fixture(pageCount = 4, prefix = 'fixture') {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([300 + index, 500 + index]);
    page.setRotation(degrees(index * 90));
    page.drawText(`${prefix}-${index + 1}`);
  }
  document.setTitle(`${prefix} title`);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

test('registry is categorized and every enabled adapter is bundled and offline', () => {
  const registry = getFormatRegistry();
  assert.deepEqual(registry.map((entry) => entry.category), [
    'Documents/PDF', 'Images', 'Audio', 'Video', 'Archives', 'Structured Data/Spreadsheets', 'Code/Text', 'Binary Encodings'
  ]);
  const formats = registry.flatMap((entry) => entry.formats);
  assert.ok(formats.some((entry) => entry.id === 'pdf' && entry.status === 'available' && entry.adapter === 'pdf-lib'));
  for (const format of formats) {
    assert.ok(['available', 'unavailable'].includes(format.status));
    if (format.status === 'available') {
      assert.equal(format.bundled, true);
      assert.ok(format.adapter && format.dependency && format.capabilities.length);
      assert.equal(format.reason, null);
      assert.doesNotMatch(format.dependency, /PATH|network|download/i);
    } else {
      assert.equal(format.bundled, false);
      assert.ok(format.missingDependency && format.reason);
      assert.equal(format.adapter, null);
    }
  }
});

test('PDF inspect reports page geometry, rotation, and metadata', async () => {
  const report = await inspectPdfBuffer(await fixture());
  assert.equal(report.pageCount, 4);
  assert.deepEqual(report.pages.map((page) => page.width), [300, 301, 302, 303]);
  assert.deepEqual(report.pages.map((page) => page.rotation), [0, 90, 180, 270]);
  assert.equal(report.metadata.title, 'fixture title');
});

test('PDF split supports every page and explicit ranges', async () => {
  const input = { name: 'source.pdf', buffer: await fixture() };
  const every = await executePdfOperation({ operation: 'split', inputs: [input] });
  assert.equal(every.outputs.length, 4);
  for (const output of every.outputs) assert.equal((await inspectPdfBuffer(output.buffer)).pageCount, 1);
  const ranged = await executePdfOperation({ operation: 'split', inputs: [input], options: { ranges: [{ start: 1, end: 3 }, { start: 4, end: 4 }], outputNames: ['first-three.pdf', 'last.pdf'] } });
  assert.deepEqual(ranged.outputs.map((entry) => entry.name), ['first-three.pdf', 'last.pdf']);
  assert.deepEqual((await inspectPdfBuffer(ranged.outputs[0].buffer)).pages.map((page) => page.width), [300, 301, 302]);
});

test('PDF merge preserves source order', async () => {
  const first = await fixture(2, 'first');
  const second = await fixture(3, 'second');
  const result = await executePdfOperation({ operation: 'merge', inputs: [{ name: 'a.pdf', buffer: first }, { name: 'b.pdf', buffer: second }] });
  assert.deepEqual((await inspectPdfBuffer(result.outputs[0].buffer)).pages.map((page) => page.width), [300, 301, 300, 301, 302]);
});

test('PDF extract, reorder, rotate, and metadata editing validate reopened output', async () => {
  const input = { name: 'source.pdf', buffer: await fixture() };
  const extracted = await executePdfOperation({ operation: 'extract-pages', inputs: [input], options: { pages: [4, 2] } });
  assert.deepEqual((await inspectPdfBuffer(extracted.outputs[0].buffer)).pages.map((page) => page.width), [303, 301]);
  const reordered = await executePdfOperation({ operation: 'reorder', inputs: [input], options: { pageOrder: [4, 3, 2, 1] } });
  assert.deepEqual((await inspectPdfBuffer(reordered.outputs[0].buffer)).pages.map((page) => page.width), [303, 302, 301, 300]);
  const rotated = await executePdfOperation({ operation: 'rotate', inputs: [input], options: { pages: [1, 3], angle: 90 } });
  assert.deepEqual((await inspectPdfBuffer(rotated.outputs[0].buffer)).pages.map((page) => page.rotation), [90, 90, 270, 270]);
  const metadata = await executePdfOperation({ operation: 'edit-metadata', inputs: [input], options: { metadata: { title: 'Edited title', author: 'Local author', subject: '' } } });
  assert.deepEqual(Object.fromEntries(Object.entries((await inspectPdfBuffer(metadata.outputs[0].buffer)).metadata).filter(([key]) => ['title', 'author', 'subject'].includes(key))), { title: 'Edited title', author: 'Local author', subject: '' });
});

test('PDF operations reject malformed input, invalid pages, duplicate reorder pages, rotations, and unsafe names', async () => {
  const input = { name: 'source.pdf', buffer: await fixture() };
  await assert.rejects(inspectPdfBuffer(Buffer.from('%PDF-not-valid')), (error) => error.code === 'MALFORMED_PDF');
  await assert.rejects(executePdfOperation({ operation: 'extract-pages', inputs: [input], options: { pages: [0] } }), (error) => error.code === 'PDF_PAGE_OUT_OF_BOUNDS');
  await assert.rejects(executePdfOperation({ operation: 'reorder', inputs: [input], options: { pageOrder: [1, 1, 2, 3] } }), (error) => error.code === 'INVALID_PDF_PAGES');
  await assert.rejects(executePdfOperation({ operation: 'rotate', inputs: [input], options: { pages: [1], angle: 45 } }), (error) => error.code === 'INVALID_PDF_ROTATION');
  await assert.rejects(executePdfOperation({ operation: 'merge', inputs: [input], options: { outputName: '../escape.pdf' } }), (error) => error.code === 'INVALID_OUTPUT_NAME');
});

test('atomic PDF writes never overwrite implicitly and leave valid output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-pdf-'));
  try {
    const output = path.join(directory, 'output.pdf');
    const buffer = await fixture();
    await writePdfAtomic(directory, output, buffer);
    assert.equal((await inspectPdfBuffer(await fs.readFile(output))).pageCount, 4);
    await assert.rejects(writePdfAtomic(directory, output, buffer), (error) => error.code === 'OUTPUT_EXISTS');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('persistent queue accepts more than 32 jobs with bounded worker concurrency and no silent overwrite', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-queue-'));
  const inputs = path.join(directory, 'inputs');
  const outputs = path.join(directory, 'outputs');
  await fs.mkdir(inputs); await fs.mkdir(outputs);
  const paths = [];
  for (let index = 0; index < 40; index += 1) {
    const file = path.join(inputs, `item-${index}.txt`);
    await fs.writeFile(file, `item ${index}`);
    paths.push(file);
  }
  let active = 0; let maximum = 0;
  const io = Object.create(fs);
  io.readFile = async (...args) => { active += 1; maximum = Math.max(maximum, active); try { await new Promise((resolve) => setTimeout(resolve, 3)); return await fs.readFile(...args); } finally { active -= 1; } };
  const queue = createPersistentConversionQueue({ statePath: path.join(directory, 'queue.json'), io, concurrency: 3 });
  try {
    assert.equal((await queue.enqueue({ paths, destinationRoot: outputs, rule: { targetFormat: 'base64', group: 'all' } })).length, 40);
    const final = await queue.resume();
    assert.equal(final.jobs.filter((job) => job.status === 'converted').length, 40);
    assert.ok(maximum <= 3);
    assert.equal((await fs.readdir(outputs)).length, 40);
    const duplicate = path.join(inputs, 'item-0.txt');
    await queue.enqueue({ paths: [duplicate], destinationRoot: outputs, rule: { targetFormat: 'base64', group: 'all' } });
    const afterDuplicate = await queue.resume();
    assert.equal(afterDuplicate.jobs.at(-1).status, 'failed');
    assert.equal(afterDuplicate.jobs.at(-1).error.code, 'OUTPUT_EXISTS');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('persistent queue records partial failures and supports cancel, retry, and restart resume', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-queue-life-'));
  const inputs = path.join(directory, 'inputs'); const outputs = path.join(directory, 'outputs'); const statePath = path.join(directory, 'queue.json');
  await fs.mkdir(inputs); await fs.mkdir(outputs);
  const good = path.join(inputs, 'good.json'); const bad = path.join(inputs, 'bad.txt');
  await fs.writeFile(good, '{"ready":true}'); await fs.writeFile(bad, 'not structured');
  try {
    const queue = createPersistentConversionQueue({ statePath, concurrency: 1 });
    await queue.enqueue({ paths: [good, bad], destinationRoot: outputs, rule: { targetFormat: 'yaml', group: 'documents' } });
    assert.equal((await queue.pause()).paused, true);
    assert.equal((await queue.snapshot()).jobs.filter((job) => job.status === 'queued').length, 2);
    const partial = await queue.resume();
    assert.equal(partial.jobs.filter((job) => job.status === 'converted').length, 1);
    assert.equal(partial.jobs.filter((job) => job.status === 'failed').length, 1);
    await fs.writeFile(bad, '{"fixed":true}');
    await queue.retry();
    assert.equal((await queue.cancel()).jobs.filter((job) => job.status === 'cancelled').length, 1);
    await queue.retry();
    const restarted = createPersistentConversionQueue({ statePath, concurrency: 1 });
    const resumed = await restarted.resume();
    assert.equal(resumed.jobs.filter((job) => job.status === 'converted').length, 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('folder enqueue filters all matches and applies an explicit per-group rule', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-queue-folder-'));
  const inputs = path.join(directory, 'inputs'); const nested = path.join(inputs, 'nested'); const outputs = path.join(directory, 'outputs');
  await fs.mkdir(nested, { recursive: true }); await fs.mkdir(outputs);
  await fs.writeFile(path.join(inputs, 'one.json'), '{"one":1}');
  await fs.writeFile(path.join(nested, 'two.json'), '{"two":2}');
  await fs.writeFile(path.join(nested, 'skip.txt'), 'skip');
  try {
    const queue = createPersistentConversionQueue({ statePath: path.join(directory, 'queue.json'), concurrency: 2 });
    const added = await queue.enqueueFolder({
      folderPath: inputs, destinationRoot: outputs, recursive: true, extensions: ['json'],
      rule: { targetFormat: 'json', group: 'records' }, groupRules: { records: { targetFormat: 'yaml' } }
    });
    assert.equal(added.length, 2);
    assert.ok(added.every((job) => job.group === 'records' && job.outputName.endsWith('.yaml')));
    const completed = await queue.resume();
    assert.equal(completed.jobs.filter((job) => job.status === 'converted').length, 2);
    assert.deepEqual((await fs.readdir(outputs)).sort(), ['one.yaml', 'two.yaml']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
