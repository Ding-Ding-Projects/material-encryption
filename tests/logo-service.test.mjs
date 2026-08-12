import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const logos = require('../src/main/logo-service.cjs');

async function fixture(format = 'png', width = 80, height = 40) {
  const pipeline = sharp({ create: { width, height, channels: 4, background: { r: 240, g: 20, b: 20, alpha: 1 } } });
  if (format === 'jpeg') return pipeline.jpeg().toBuffer();
  if (format === 'webp') return pipeline.webp().toBuffer();
  return pipeline.png().toBuffer();
}

test('normalizes supported magic-byte formats into bounded still PNG', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const result = await logos.validateAndNormalize(await fixture(format));
    assert.equal(result.sourceFormat, format);
    assert.deepEqual([...result.normalized.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const metadata = await sharp(result.normalized).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.pages || 1, 1);
    assert.ok(metadata.width <= 1024 && metadata.height <= 1024);
  }
});

test('rejects extension-style spoofing, animated markers, and exact bound violations', async () => {
  await assert.rejects(logos.validateAndNormalize(Buffer.from('not really a png')), { code: 'LOGO_TYPE' });
  const oversized = Buffer.alloc(logos.constants.INPUT_BYTE_LIMIT + 1); oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(logos.validateAndNormalize(oversized), { code: 'LOGO_BYTES' });
  const png = await fixture('png');
  const animated = Buffer.concat([png.subarray(0, 8), Buffer.from([0, 0, 0, 0]), Buffer.from('acTL'), Buffer.alloc(4), png.subarray(8)]);
  await assert.rejects(logos.validateAndNormalize(animated), { code: 'LOGO_ANIMATED' });
  const bombHeader = await fixture('png', 1, 1);
  bombHeader.writeUInt32BE(4097, 16); bombHeader.writeUInt32BE(4097, 20);
  await assert.rejects(logos.validateAndNormalize(bombHeader), (error) => ['LOGO_DECODE', 'LOGO_PIXELS'].includes(error.code));
});

test('validates fit, background, focal point, and crop bounds exactly', () => {
  assert.deepEqual(logos.validateOptions({ fit: 'cover', background: '#AABBCC', focalX: 0, focalY: 1, cropZoom: 3 }), { fit: 'cover', background: '#aabbcc', focalX: 0, focalY: 1, cropZoom: 3 });
  for (const options of [{ fit: 'stretch' }, { background: 'red' }, { focalX: -0.01 }, { focalY: 1.01 }, { cropZoom: 3.01 }, { sourcePath: 'C:\\secret.png' }]) {
    assert.throws(() => logos.validateOptions(options), { code: 'LOGO_OPTIONS' });
  }
});

test('uses dialog-issued opaque capability and publishes complete validated generations', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'material-encryption-logo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selectedPath = path.join(root, 'selected.webp');
  await writeFile(selectedPath, await fixture('webp', 160, 80));
  const service = logos.createLogoService({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }) }, ownerWindow: () => null, dataRoot: path.join(root, 'data') });
  const selected = await service.select();
  assert.match(selected.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(Object.hasOwn(selected, 'path'), false);
  assert.equal(Object.hasOwn(selected, 'sourcePath'), false);
  const options = { fit: 'cover', background: '#113355', focalX: 0.8, focalY: 0.2, cropZoom: 2 };
  const preview = await service.preview({ token: selected.token, options });
  assert.deepEqual(preview.sizes, logos.constants.ICON_SIZES);
  assert.equal(Object.hasOwn(preview, 'dataUrl'), false);
  const applied = await service.apply({ token: selected.token, options });
  assert.equal(applied.custom, true);
  await assert.rejects(service.apply({ token: selected.token, options }), { code: 'LOGO_TOKEN' });
  const state = await service.state();
  assert.deepEqual(state.options, options);
  for (const size of state.sizes) {
    const bytes = await service.asset(state.assetId, size);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, size); assert.equal(metadata.height, size); assert.equal(metadata.pages || 1, 1);
  }
  const active = JSON.parse(await readFile(path.join(root, 'data', 'active.v1.json'), 'utf8'));
  assert.match(active.generation, /^[a-f0-9]{32}$/);
});

test('contain and cover/focal generation differ without stretching', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'material-encryption-logo-fit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selectedPath = path.join(root, 'wide.png'); await writeFile(selectedPath, await fixture('png', 200, 50));
  const service = logos.createLogoService({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }) }, ownerWindow: () => null, dataRoot: path.join(root, 'data') });
  const selected = await service.select();
  const contain = await service.preview({ token: selected.token, options: { fit: 'contain', background: '#0000ff', focalX: 0.5, focalY: 0.5, cropZoom: 1 } });
  const cover = await service.preview({ token: selected.token, options: { fit: 'cover', background: '#0000ff', focalX: 1, focalY: 0.5, cropZoom: 2 } });
  assert.notDeepEqual(await service.asset(contain.previewId, 256), await service.asset(cover.previewId, 256));
});

test('renderer logo bridge contains no source-path, file-input, raw read, or canvas download seam', async () => {
  const design = await readFile('design/VeraCrypt Material.dc.html', 'utf8');
  const preload = await readFile('src/main/preload.cjs', 'utf8');
  const main = await readFile('src/main/main.cjs', 'utf8');
  assert.doesNotMatch(design, /type=["']file["']|FileReader|readAsDataURL|canvas\.toDataURL|logo-local-image|customData|previewDataUrl|entry\.dataUrl/);
  assert.match(preload, /selectLogoImage: \(\) => invoke\('logo:select'\)/);
  assert.doesNotMatch(preload, /selectLogoImage: \([^)]*(path|dataUrl)/i);
  assert.match(main, /logoPayload\(value, \['token', 'options'\]\)/);
  assert.doesNotMatch(main, /logoPayload\(value, \[[^\]]*(path|dataUrl)/i);
});
