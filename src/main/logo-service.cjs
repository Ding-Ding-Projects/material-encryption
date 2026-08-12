'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const INPUT_BYTE_LIMIT = 5 * 1024 * 1024;
const INPUT_DIMENSION_LIMIT = 4096;
const INPUT_PIXEL_LIMIT = 4096 * 4096;
const NORMALIZED_DIMENSION_LIMIT = 1024;
const NORMALIZED_BYTE_LIMIT = 5 * 1024 * 1024;
const MAX_SELECTIONS = 8;
const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);
const DEFAULT_OPTIONS = Object.freeze({ fit: 'contain', background: '#0842a0', focalX: 0.5, focalY: 0.5, cropZoom: 1 });

class LogoError extends Error {
  constructor(code, message) { super(message); this.name = 'LogoError'; this.code = code; }
}

function publicError(error) {
  if (error instanceof LogoError) return error;
  return new LogoError('LOGO_FAILED', 'The logo could not be processed safely. The previous logo is still active.');
}

function detectFormat(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new LogoError('LOGO_TYPE', 'Choose a real PNG, JPEG, or WebP image. The file signature did not match a supported format.');
}

function pngChunkTypes(bytes) {
  const types = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset); const end = offset + 12 + length;
    if (end > bytes.length) throw new LogoError('LOGO_DECODE', 'The PNG chunk table is truncated or malformed.');
    types.push(bytes.toString('ascii', offset + 4, offset + 8)); offset = end;
  }
  return types;
}

function webpChunkTypes(bytes) {
  const types = [];
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4); const end = offset + 8 + length + (length % 2);
    if (end > bytes.length) throw new LogoError('LOGO_DECODE', 'The WebP chunk table is truncated or malformed.');
    types.push(bytes.toString('ascii', offset, offset + 4)); offset = end;
  }
  return types;
}

function rejectKnownAnimation(bytes, format) {
  if (format === 'png' && pngChunkTypes(bytes).includes('acTL')) throw new LogoError('LOGO_ANIMATED', 'Animated or multi-frame images are not supported. Choose one still image.');
  if (format === 'webp' && webpChunkTypes(bytes).some((type) => type === 'ANIM' || type === 'ANMF')) throw new LogoError('LOGO_ANIMATED', 'Animated or multi-frame images are not supported. Choose one still image.');
  if (format === 'jpeg') {
    for (let offset = 2; offset + 4 <= bytes.length && bytes[offset] === 0xff;) {
      const marker = bytes[offset + 1]; if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset + 2); if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe2 && bytes.toString('ascii', offset + 4, offset + 8) === 'MPF\0') throw new LogoError('LOGO_MULTIPAGE', 'Multi-picture JPEG files are not supported. Choose one still image.');
      offset += 2 + length;
    }
  }
}

function numberInRange(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new LogoError('LOGO_OPTIONS', `${name} is outside the supported range.`);
  return number;
}

function validateOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LogoError('LOGO_OPTIONS', 'Logo options must be an object.');
  const allowed = ['fit', 'background', 'focalX', 'focalY', 'cropZoom'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new LogoError('LOGO_OPTIONS', 'Logo options contain unsupported fields.');
  const fit = value.fit == null ? DEFAULT_OPTIONS.fit : value.fit;
  const background = value.background == null ? DEFAULT_OPTIONS.background : value.background;
  if (!['contain', 'cover'].includes(fit)) throw new LogoError('LOGO_OPTIONS', 'Logo fit must be contain or cover.');
  if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) throw new LogoError('LOGO_OPTIONS', 'Logo background must be a six-digit hexadecimal color.');
  return {
    fit,
    background: background.toLowerCase(),
    focalX: numberInRange(value.focalX ?? DEFAULT_OPTIONS.focalX, 'Horizontal focal point', 0, 1),
    focalY: numberInRange(value.focalY ?? DEFAULT_OPTIONS.focalY, 'Vertical focal point', 0, 1),
    cropZoom: numberInRange(value.cropZoom ?? DEFAULT_OPTIONS.cropZoom, 'Crop zoom', 1, 3)
  };
}

function colorChannels(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), alpha: 1 };
}

async function boundedRead(filePath) {
  const link = await fs.lstat(filePath);
  if (link.isSymbolicLink()) throw new LogoError('LOGO_LINK', 'Linked image files are not accepted. Choose the original file directly.');
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 12 || before.size > INPUT_BYTE_LIMIT) throw new LogoError('LOGO_BYTES', `Logo files must be between 12 bytes and exactly ${INPUT_BYTE_LIMIT} bytes.`);
    if (link.dev !== before.dev || link.ino !== before.ino) throw new LogoError('LOGO_CHANGED', 'The selected image changed before it could be read. Choose it again.');
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== bytes.length || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new LogoError('LOGO_CHANGED', 'The selected image changed while it was being read. Choose it again.');
    return bytes;
  } finally { await handle.close(); }
}

async function atomicWrite(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try { const handle = await fs.open(temporary, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } await fs.rename(temporary, filePath); }
  catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
}

async function replaceFile(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  const backup = `${filePath}.${crypto.randomUUID()}.bak`;
  let backedUp = false;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(filePath, backup); backedUp = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(temporary, filePath); }
    catch (error) { if (backedUp) await fs.rename(backup, filePath).catch(() => {}); throw error; }
    if (backedUp) await fs.rm(backup, { force: true });
  } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); if (backedUp) await fs.rename(backup, filePath).catch(() => {}); throw error; }
}

async function validateAndNormalize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > INPUT_BYTE_LIMIT) throw new LogoError('LOGO_BYTES', `Logo files may be no larger than exactly ${INPUT_BYTE_LIMIT} bytes.`);
  const format = detectFormat(bytes);
  rejectKnownAnimation(bytes, format);
  let metadata;
  try { metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT, sequentialRead: true }).metadata(); }
  catch (_) { throw new LogoError('LOGO_DECODE', 'The selected image is malformed or exceeds the safe decode limit.'); }
  if (metadata.format !== format || !metadata.width || !metadata.height) throw new LogoError('LOGO_TYPE', 'The decoded image type did not match its file signature.');
  if ((metadata.pages || 1) !== 1 || metadata.pageHeight && metadata.pageHeight !== metadata.height) throw new LogoError('LOGO_ANIMATED', 'Animated or multi-frame images are not supported. Choose one still image.');
  if (metadata.width > INPUT_DIMENSION_LIMIT || metadata.height > INPUT_DIMENSION_LIMIT || metadata.width * metadata.height > INPUT_PIXEL_LIMIT) {
    throw new LogoError('LOGO_PIXELS', `Images are limited to ${INPUT_DIMENSION_LIMIT} pixels per side and exactly ${INPUT_PIXEL_LIMIT} decoded pixels.`);
  }
  let normalized;
  try {
    normalized = await sharp(bytes, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT, sequentialRead: true })
      .rotate().resize({ width: NORMALIZED_DIMENSION_LIMIT, height: NORMALIZED_DIMENSION_LIMIT, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .png({ compressionLevel: 9, adaptiveFiltering: true, force: true }).toBuffer();
  } catch (_) { throw new LogoError('LOGO_DECODE', 'The selected image could not be decoded into a safe still PNG.'); }
  if (normalized.length > NORMALIZED_BYTE_LIMIT) throw new LogoError('LOGO_OUTPUT_BYTES', 'The normalized PNG exceeds the bounded local asset limit. Choose a simpler image.');
  const normalizedMetadata = await sharp(normalized, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT }).metadata();
  if (normalizedMetadata.format !== 'png' || (normalizedMetadata.pages || 1) !== 1 || !normalizedMetadata.width || !normalizedMetadata.height) throw new LogoError('LOGO_OUTPUT', 'The normalized logo did not pass output validation.');
  return { normalized, sourceFormat: format, width: normalizedMetadata.width, height: normalizedMetadata.height, inputBytes: bytes.length };
}

async function renderSize(source, size, options) {
  const metadata = await sharp(source, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT }).metadata();
  let pipeline = sharp(source, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT });
  if (options.fit === 'cover') {
    const side = Math.max(1, Math.floor(Math.min(metadata.width, metadata.height) / options.cropZoom));
    const left = Math.max(0, Math.min(metadata.width - side, Math.round(options.focalX * metadata.width - side / 2)));
    const top = Math.max(0, Math.min(metadata.height - side, Math.round(options.focalY * metadata.height - side / 2)));
    pipeline = pipeline.extract({ left, top, width: side, height: side }).resize(size, size, { fit: 'fill' });
  } else {
    pipeline = pipeline.resize(size, size, { fit: 'contain', background: colorChannels(options.background), withoutEnlargement: false });
  }
  const output = await pipeline.flatten({ background: colorChannels(options.background) }).png({ compressionLevel: 9, force: true }).toBuffer();
  const check = await sharp(output, { failOn: 'error', limitInputPixels: size * size }).metadata();
  if (check.format !== 'png' || check.width !== size || check.height !== size || (check.pages || 1) !== 1) throw new LogoError('LOGO_OUTPUT', `The ${size}-pixel PNG failed output validation.`);
  return output;
}

function createLogoService({ dialog, ownerWindow, dataRoot }) {
  if (!dialog || typeof dialog.showOpenDialog !== 'function' || typeof dialog.showOpenDialog !== 'function') throw new TypeError('A dialog implementation is required.');
  const selections = new Map();
  const previewsById = new Map();
  const generationsRoot = path.join(dataRoot, 'generations');
  const activePath = path.join(dataRoot, 'active.v1.json');
  let mutation = Promise.resolve();

  function serialized(callback) { const operation = mutation.then(callback, callback); mutation = operation.catch(() => {}); return operation; }

  async function activeGeneration() {
    let record;
    try { record = JSON.parse(await fs.readFile(activePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new LogoError('LOGO_STATE', 'The active logo record is unreadable. The shipped logo remains active.'); }
    if (!record || typeof record !== 'object' || Object.keys(record).length !== 1 || !/^[a-f0-9]{32}$/.test(record.generation || '')) throw new LogoError('LOGO_STATE', 'The active logo record is invalid. The shipped logo remains active.');
    return path.join(generationsRoot, record.generation);
  }

  async function persistedSource() {
    const active = await activeGeneration(); if (!active) return null;
    const bytes = await fs.readFile(path.join(active, 'source.png')).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!bytes) return null;
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: INPUT_PIXEL_LIMIT }).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width * metadata.height > INPUT_PIXEL_LIMIT || (metadata.pages || 1) !== 1 || bytes.length > NORMALIZED_BYTE_LIMIT) throw new LogoError('LOGO_STATE', 'The saved custom logo is invalid. The shipped logo remains active.');
    return bytes;
  }

  async function loadOptions() {
    try { const active = await activeGeneration(); return active ? validateOptions(JSON.parse(await fs.readFile(path.join(active, 'settings.v1.json'), 'utf8'))) : DEFAULT_OPTIONS; }
    catch (_) { throw new LogoError('LOGO_STATE', 'Saved logo settings are invalid. The shipped defaults remain active.'); }
  }

  async function renderPreviews(source, options) {
    const entries = [];
    for (const size of ICON_SIZES) entries.push({ size, bytes: await renderSize(source, size, options) });
    return entries;
  }

  function retainPreview(sourceId, rendered) {
    const previewId = crypto.randomBytes(24).toString('base64url');
    previewsById.set(previewId, { sourceId, rendered: new Map(rendered.map((entry) => [entry.size, entry.bytes])) });
    while (previewsById.size > MAX_SELECTIONS * 2) previewsById.delete(previewsById.keys().next().value);
    setTimeout(() => previewsById.delete(previewId), 10 * 60 * 1000).unref?.();
    return previewId;
  }

  return Object.freeze({
    async select() {
      const result = await dialog.showOpenDialog(ownerWindow(), { title: 'Choose a local app logo', properties: ['openFile'], filters: [{ name: 'Supported still images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (result.canceled || result.filePaths.length !== 1) return null;
      const validated = await validateAndNormalize(await boundedRead(result.filePaths[0]));
      if (selections.size >= MAX_SELECTIONS) selections.delete(selections.keys().next().value);
      const token = crypto.randomBytes(24).toString('base64url');
      selections.set(token, validated.normalized);
      setTimeout(() => selections.delete(token), 10 * 60 * 1000).unref?.();
      return { token, sourceFormat: validated.sourceFormat, width: validated.width, height: validated.height, inputBytes: validated.inputBytes };
    },
    async preview({ token, options }) {
      const source = token ? selections.get(token) : await persistedSource();
      if (!source) throw new LogoError('LOGO_TOKEN', 'The logo selection expired. Choose the image again.');
      const safeOptions = validateOptions(options);
      const rendered = await renderPreviews(source, safeOptions);
      const previewId = retainPreview(token || 'persisted', rendered);
      return { options: safeOptions, previewId, sizes: ICON_SIZES };
    },
    async apply({ token, options }) {
      return serialized(async () => {
        const source = token ? selections.get(token) : await persistedSource();
        if (!source) throw new LogoError('LOGO_TOKEN', 'The logo selection expired. Choose the image again.');
        if (token) selections.delete(token);
        const safeOptions = validateOptions(options);
        const rendered = await renderPreviews(source, safeOptions);
        const generation = crypto.randomBytes(16).toString('hex');
        const staged = path.join(dataRoot, `.generation-${generation}.tmp`);
        const complete = path.join(generationsRoot, generation);
        try {
          await fs.mkdir(path.join(staged, 'icons'), { recursive: true });
          await fs.writeFile(path.join(staged, 'source.png'), source, { flag: 'wx' });
          await fs.writeFile(path.join(staged, 'settings.v1.json'), JSON.stringify(safeOptions), { flag: 'wx' });
          for (const entry of rendered) await fs.writeFile(path.join(staged, 'icons', `${entry.size}.png`), entry.bytes, { flag: 'wx' });
          await fs.mkdir(generationsRoot, { recursive: true });
          await fs.rename(staged, complete);
          await replaceFile(activePath, Buffer.from(JSON.stringify({ generation }), 'utf8'));
        } catch (error) { await fs.rm(staged, { recursive: true, force: true }).catch(() => {}); await fs.rm(complete, { recursive: true, force: true }).catch(() => {}); throw error; }
        const entries = await fs.readdir(generationsRoot, { withFileTypes: true });
        await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== generation && /^[a-f0-9]{32}$/.test(entry.name)).map((entry) => fs.rm(path.join(generationsRoot, entry.name), { recursive: true, force: true })));
        return { custom: true, options: safeOptions, assetId: generation, sizes: ICON_SIZES };
      });
    },
    async state() {
      const source = await persistedSource();
      if (!source) return { custom: false, options: DEFAULT_OPTIONS, previews: [] };
      const options = await loadOptions();
      const active = await activeGeneration();
      return { custom: true, options, assetId: path.basename(active), sizes: ICON_SIZES };
    },
    async reset() {
      return serialized(async () => { await fs.rm(activePath, { force: true }); await fs.rm(generationsRoot, { recursive: true, force: true }); selections.clear(); previewsById.clear(); return { custom: false, options: DEFAULT_OPTIONS, sizes: [] }; });
    },
    async asset(assetId, size) {
      if (typeof assetId !== 'string' || !/^(?:[A-Za-z0-9_-]{32}|[a-f0-9]{32})$/.test(assetId)) throw new LogoError('LOGO_ASSET', 'The logo asset capability is invalid.');
      if (!ICON_SIZES.includes(size)) throw new LogoError('LOGO_ASSET', 'The requested logo size is not supported.');
      const preview = previewsById.get(assetId);
      if (preview) return preview.rendered.get(size);
      const active = await activeGeneration();
      if (!active || path.basename(active) !== assetId) throw new LogoError('LOGO_ASSET', 'The logo asset capability expired.');
      const bytes = await fs.readFile(path.join(active, 'icons', `${size}.png`));
      const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: size * size }).metadata();
      if (bytes.length > NORMALIZED_BYTE_LIMIT || metadata.format !== 'png' || metadata.width !== size || metadata.height !== size || (metadata.pages || 1) !== 1) throw new LogoError('LOGO_OUTPUT', 'The stored logo asset failed validation.');
      return bytes;
    }
  });
}

module.exports = { createLogoService, validateAndNormalize, validateOptions, detectFormat, publicError, constants: { INPUT_BYTE_LIMIT, INPUT_DIMENSION_LIMIT, INPUT_PIXEL_LIMIT, NORMALIZED_BYTE_LIMIT, MAX_SELECTIONS, ICON_SIZES, DEFAULT_OPTIONS } };
