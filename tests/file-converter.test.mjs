import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  MAX_INPUT_BYTES,
  availableConversions,
  convertBuffer,
  createConverterService,
  detectFormat,
  publicError,
  validateDestination,
  writeGuarded
} = require('../src/main/file-converter.cjs');

function bytes(value) { return Buffer.from(value, 'utf8'); }

test('content signatures take priority and extension disagreements remain visible', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.deepEqual(detectFormat(png, 'renamed.json'), {
    format: 'png', label: 'PNG image', extensionFormat: 'json', basis: 'signature', extensionMismatch: true, supported: true
  });
  assert.equal(detectFormat(bytes('{"ready":true}'), 'notes.txt').format, 'json');
  assert.equal(detectFormat(bytes('{"a":1}\n{"a":2}\n'), 'records.bin').format, 'jsonl');
  assert.equal(detectFormat(bytes('<html><body>Hello</body></html>'), 'page.xml').format, 'html');
  assert.equal(detectFormat(bytes('<root><item>Hello</item></root>'), 'data.txt').format, 'xml');
});

test('explicit conversion inventory excludes lossy image paths', () => {
  assert.deepEqual(availableConversions('jpeg').map((entry) => entry.format), ['jpeg', 'png']);
  assert.deepEqual(availableConversions('png').map((entry) => entry.format), ['png']);
  assert.throws(() => convertBuffer(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), { sourceFormat: 'png', targetFormat: 'jpeg' }), /unsupported or would be lossy/);
});

test('JSON records convert reliably through JSONL, CSV, TSV, YAML, XML, HTML and Markdown', () => {
  const source = bytes('[{"name":"Ada","score":4},{"name":"Lin","score":5}]');
  const jsonl = convertBuffer(source, { sourceFormat: 'json', targetFormat: 'jsonl' }).buffer;
  assert.equal(jsonl.toString(), '{"name":"Ada","score":4}\n{"name":"Lin","score":5}\n');
  const csv = convertBuffer(source, { sourceFormat: 'json', targetFormat: 'csv' }).buffer;
  assert.equal(csv.toString(), 'name,score\nAda,4\nLin,5\n');
  const tsv = convertBuffer(csv, { sourceFormat: 'csv', targetFormat: 'tsv' }).buffer;
  assert.equal(tsv.toString(), 'name\tscore\nAda\t4\nLin\t5\n');
  const yaml = convertBuffer(bytes('{"ready":true,"count":2}'), { sourceFormat: 'json', targetFormat: 'yaml' }).buffer;
  assert.deepEqual(JSON.parse(convertBuffer(yaml, { sourceFormat: 'yaml', targetFormat: 'json' }).buffer), { ready: true, count: 2 });
  const xml = convertBuffer(bytes('{"ready":true,"count":2}'), { sourceFormat: 'json', targetFormat: 'xml' }).buffer;
  assert.deepEqual(JSON.parse(convertBuffer(xml, { sourceFormat: 'xml', targetFormat: 'json' }).buffer), { ready: true, count: 2 });
  const toml = convertBuffer(bytes('{"ready":true,"count":2}'), { sourceFormat: 'json', targetFormat: 'toml' }).buffer;
  assert.deepEqual(JSON.parse(convertBuffer(toml, { sourceFormat: 'toml', targetFormat: 'json' }).buffer), { ready: true, count: 2 });
  assert.match(convertBuffer(source, { sourceFormat: 'json', targetFormat: 'html' }).buffer.toString(), /<pre>/);
  assert.match(convertBuffer(source, { sourceFormat: 'json', targetFormat: 'markdown' }).buffer.toString(), /^```json/m);
});

test('plain text, Markdown, Base64 and hexadecimal conversions preserve bytes', () => {
  const source = bytes('Hello, 世界!\n');
  const base64 = convertBuffer(source, { sourceFormat: 'text', targetFormat: 'base64' }).buffer;
  const hex = convertBuffer(base64, { sourceFormat: 'base64', targetFormat: 'hex' }).buffer;
  const restored = convertBuffer(hex, { sourceFormat: 'hex', targetFormat: 'text' }).buffer;
  assert.deepEqual(restored, source);
  const html = convertBuffer(bytes('# Heading\n\nBody & more'), { sourceFormat: 'markdown', targetFormat: 'html' }).buffer.toString();
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /Body &amp; more/);
});

test('arbitrary binary data has explicit Base64 and hexadecimal round trips', () => {
  const source = Buffer.from([0, 1, 2, 127, 128, 255]);
  assert.equal(detectFormat(source, 'payload.bin').format, 'binary');
  const encoded = convertBuffer(source, { sourceFormat: 'binary', targetFormat: 'base64' }).buffer;
  assert.deepEqual(convertBuffer(encoded, { sourceFormat: 'base64', targetFormat: 'binary' }).buffer, source);
  assert.deepEqual(availableConversions('binary').map((entry) => entry.format), ['binary', 'base64', 'hex']);
});

test('malformed, oversize and unsupported inputs fail with stable safe errors', () => {
  assert.throws(() => convertBuffer(bytes('{nope'), { sourceFormat: 'json', targetFormat: 'yaml' }), (error) => error.code === 'MALFORMED_INPUT');
  assert.throws(() => convertBuffer(bytes('name,value\n"open,1\n'), { sourceFormat: 'csv', targetFormat: 'json' }), (error) => error.code === 'MALFORMED_INPUT');
  assert.throws(() => detectFormat(Buffer.alloc(MAX_INPUT_BYTES + 1), 'large.bin'), (error) => error.code === 'INPUT_TOO_LARGE');
  assert.deepEqual(publicError(new Error('C:\\private\\secret.txt token=abc')), { code: 'CONVERSION_FAILED', message: 'The conversion could not be completed.' });
});

test('native image boundary permits JPEG to PNG but refuses image backend failures', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false, toPNG: () => png }) };
  assert.deepEqual(convertBuffer(jpeg, { sourceFormat: 'jpeg', targetFormat: 'png', nativeImage }).buffer, png);
  assert.throws(() => convertBuffer(jpeg, { sourceFormat: 'jpeg', targetFormat: 'png' }), (error) => error.code === 'IMAGE_BACKEND_UNAVAILABLE');
});

test('destination validation rejects traversal, same-root writes and overwrite by default', async () => {
  assert.match(validateDestination('C:\\safe', 'C:\\safe\\report.json'), /report\.json$/);
  assert.throws(() => validateDestination('C:\\safe', 'C:\\other\\report.json'), (error) => error.code === 'DESTINATION_OUTSIDE_SELECTION');
  assert.throws(() => validateDestination('C:\\safe', 'C:\\safe'), (error) => error.code === 'DESTINATION_OUTSIDE_SELECTION');
  const calls = [];
  const io = { writeFile: async (...args) => { calls.push(args); const error = new Error('exists at C:\\private'); error.code = 'EEXIST'; throw error; } };
  await assert.rejects(writeGuarded('C:\\safe', 'C:\\safe\\report.json', bytes('{}'), { io }), (error) => error.code === 'OUTPUT_EXISTS' && !error.message.includes('private'));
  assert.equal(calls[0][2].flag, 'wx');
  const symlinkIo = { lstat: async () => ({ isSymbolicLink: () => true }), writeFile: async () => assert.fail('symbolic-link output must not be opened') };
  await assert.rejects(writeGuarded('C:\\safe', 'C:\\safe\\linked.json', bytes('{}'), { overwrite: true, io: symlinkIo }), (error) => error.code === 'UNSAFE_DESTINATION');
});

test('service exposes only dialog-selected capabilities and reports batch partial failures', async () => {
  const files = new Map([
    ['C:\\input\\one.json', bytes('{"name":"one"}')],
    ['C:\\input\\two.txt', bytes('not structured')]
  ]);
  const written = new Map();
  const io = {
    stat: async (filePath) => ({ isFile: () => true, size: files.get(filePath).length }),
    readFile: async (filePath) => files.get(filePath),
    writeFile: async (filePath, value, options) => {
      if (written.has(filePath) && options.flag === 'wx') { const error = new Error('exists'); error.code = 'EEXIST'; throw error; }
      written.set(filePath, Buffer.from(value));
    }
  };
  const openResults = [
    { canceled: false, filePaths: ['C:\\input\\one.json', 'C:\\input\\two.txt'] },
    { canceled: false, filePaths: ['C:\\output'] }
  ];
  const dialog = { showOpenDialog: async () => openResults.shift(), showSaveDialog: async () => ({ canceled: true }) };
  const service = createConverterService({ dialog, io });
  const selected = await service.selectBatchInputs();
  const destination = await service.selectDestination();
  assert.throws(() => service.inspect({ inputToken: 'invented-capability' }), (error) => error.code === 'UNKNOWN_SELECTION');
  const result = await service.runBatch({ inputTokens: selected.map((entry) => entry.inputToken), targetFormat: 'yaml', destinationToken: destination.destinationToken, confirmOverwrite: false });
  const plan = service.planBatch({ inputTokens: selected.map((entry) => entry.inputToken), targetFormat: 'yaml', destinationToken: destination.destinationToken });
  assert.equal(Object.hasOwn(plan[0], 'destination'), false);
  assert.equal(result.converted, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.items[0].status, 'converted');
  assert.deepEqual(result.items[1].error, { code: 'UNSUPPORTED_CONVERSION', message: 'That conversion is unsupported or would be lossy.' });
  assert.equal([...written.keys()].length, 1);
});

test('a selected capability cannot silently convert replacement file contents', async () => {
  const filePath = 'C:\\input\\selected.json';
  let current = bytes('{"version":1}');
  const io = {
    stat: async () => ({ isFile: () => true, size: current.length }),
    readFile: async () => Buffer.from(current),
    writeFile: async () => assert.fail('changed input must not be written')
  };
  const dialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
    showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\output\\converted.yaml' })
  };
  const service = createConverterService({ dialog, io });
  const selected = await service.selectInput();
  current = bytes('{"version":2}');
  await assert.rejects(service.preview({ inputToken: selected.inputToken, targetFormat: 'yaml' }), (error) => error.code === 'INPUT_CHANGED');
});
