'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { PDFDocument, degrees } = require('pdf-lib');

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_ITEMS = Number.POSITIVE_INFINITY;
const MAX_PREVIEW_CHARS = 4096;
const MAX_PDF_AGGREGATE_INPUT_BYTES = 64 * 1024 * 1024;
const PDF_PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_PDF_PLANS = 32;
const MAX_QUEUE_JOBS = 100000;

const FORMATS = Object.freeze({
  binary: { label: 'Binary data', extensions: ['bin', 'dat'] },
  pdf: { label: 'PDF document', extensions: ['pdf'] },
  text: { label: 'UTF-8 plain text', extensions: ['txt'] },
  markdown: { label: 'Markdown', extensions: ['md', 'markdown'] },
  json: { label: 'JSON', extensions: ['json'] },
  jsonl: { label: 'JSON Lines', extensions: ['jsonl', 'ndjson'] },
  yaml: { label: 'YAML', extensions: ['yaml', 'yml'] },
  toml: { label: 'TOML', extensions: ['toml'] },
  xml: { label: 'XML', extensions: ['xml'] },
  csv: { label: 'CSV', extensions: ['csv'] },
  tsv: { label: 'TSV', extensions: ['tsv'] },
  html: { label: 'HTML', extensions: ['html', 'htm'] },
  base64: { label: 'Base64', extensions: ['base64', 'b64'] },
  hex: { label: 'Hexadecimal', extensions: ['hex'] },
  png: { label: 'PNG image', extensions: ['png'] },
  jpeg: { label: 'JPEG image', extensions: ['jpg', 'jpeg'] }
});

const EXTENSION_TO_FORMAT = new Map(Object.entries(FORMATS).flatMap(([format, details]) => details.extensions.map((extension) => [extension, format])));
const CONVERSIONS = Object.freeze({
  binary: ['binary', 'base64', 'hex'],
  pdf: ['pdf'],
  text: ['text', 'markdown', 'base64', 'hex'],
  markdown: ['markdown', 'text', 'html', 'base64', 'hex'],
  json: ['json', 'jsonl', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'html', 'markdown', 'base64', 'hex'],
  jsonl: ['jsonl', 'json', 'yaml', 'xml', 'csv', 'tsv', 'html', 'markdown', 'base64', 'hex'],
  yaml: ['yaml', 'json', 'jsonl', 'xml', 'csv', 'tsv', 'html', 'markdown', 'base64', 'hex'],
  toml: ['toml', 'json', 'yaml', 'xml', 'html', 'markdown', 'base64', 'hex'],
  xml: ['xml', 'json', 'yaml', 'html', 'markdown', 'base64', 'hex'],
  csv: ['csv', 'tsv', 'json', 'jsonl', 'yaml', 'xml', 'html', 'markdown', 'base64', 'hex'],
  tsv: ['tsv', 'csv', 'json', 'jsonl', 'yaml', 'xml', 'html', 'markdown', 'base64', 'hex'],
  html: ['html', 'text', 'base64', 'hex'],
  base64: ['base64', 'hex', 'text', 'binary'],
  hex: ['hex', 'base64', 'text', 'binary'],
  png: ['png'],
  jpeg: ['jpeg', 'png']
});

const FORMAT_REGISTRY = Object.freeze([
  registryCategory('Documents/PDF', [
    availableFormat('pdf', 'PDF', ['pdf'], 'pdf-lib', ['inspect', 'split', 'merge', 'extract-pages', 'reorder', 'rotate', 'edit-metadata']),
    unavailableFormat('docx', 'Microsoft Word', ['docx'], 'DOCX adapter', 'No bundled DOCX rendering adapter is installed.'),
    unavailableFormat('odt', 'OpenDocument Text', ['odt'], 'ODT adapter', 'No bundled OpenDocument rendering adapter is installed.'),
    unavailableFormat('rtf', 'Rich Text Format', ['rtf'], 'RTF adapter', 'No bundled RTF parser and renderer is installed.')
  ]),
  registryCategory('Images', [
    availableFormat('png', 'PNG', ['png'], 'bundled converter core', ['identity']),
    availableFormat('jpeg', 'JPEG', ['jpg', 'jpeg'], 'Electron nativeImage', ['identity', 'to-png']),
    unavailableFormat('gif', 'GIF', ['gif'], 'GIF adapter', 'No bundled GIF decoder and encoder is installed.'),
    unavailableFormat('webp', 'WebP', ['webp'], 'WebP adapter', 'No bundled WebP decoder and encoder is installed.'),
    unavailableFormat('svg', 'SVG', ['svg'], 'safe SVG adapter', 'No bundled isolated SVG renderer is installed.'),
    unavailableFormat('tiff', 'TIFF', ['tif', 'tiff'], 'TIFF adapter', 'No bundled TIFF decoder and encoder is installed.')
  ]),
  registryCategory('Audio', [
    unavailableFormat('mp3', 'MP3', ['mp3'], 'audio codec adapter', 'No bundled offline MP3 codec is installed.'),
    unavailableFormat('wav', 'WAV', ['wav'], 'audio codec adapter', 'No bundled offline WAV adapter is installed.'),
    unavailableFormat('flac', 'FLAC', ['flac'], 'audio codec adapter', 'No bundled offline FLAC codec is installed.'),
    unavailableFormat('ogg', 'Ogg', ['ogg'], 'audio codec adapter', 'No bundled offline Ogg codec is installed.')
  ]),
  registryCategory('Video', [
    unavailableFormat('mp4', 'MP4', ['mp4'], 'video codec adapter', 'No bundled offline MP4 codec is installed; tools on PATH are never used.'),
    unavailableFormat('webm', 'WebM', ['webm'], 'video codec adapter', 'No bundled offline WebM codec is installed; tools on PATH are never used.'),
    unavailableFormat('mkv', 'Matroska', ['mkv'], 'video codec adapter', 'No bundled offline Matroska codec is installed; tools on PATH are never used.'),
    unavailableFormat('mov', 'QuickTime', ['mov'], 'video codec adapter', 'No bundled offline QuickTime codec is installed; tools on PATH are never used.')
  ]),
  registryCategory('Archives', [
    unavailableFormat('zip', 'ZIP', ['zip'], 'archive adapter', 'No bundled bounded ZIP adapter is installed.'),
    unavailableFormat('7z', '7z', ['7z'], '7z adapter', 'No bundled bounded 7z adapter is installed.'),
    unavailableFormat('tar', 'TAR', ['tar'], 'TAR adapter', 'No bundled bounded TAR adapter is installed.'),
    unavailableFormat('gzip', 'Gzip', ['gz'], 'Gzip adapter', 'No bundled bounded Gzip adapter is installed.')
  ]),
  registryCategory('Structured Data/Spreadsheets', [
    ...['json', 'jsonl', 'yaml', 'toml', 'xml', 'csv', 'tsv'].map((id) => availableFormat(id, FORMATS[id].label, FORMATS[id].extensions, 'bundled converter core', ['convert'])),
    unavailableFormat('xlsx', 'Microsoft Excel', ['xlsx'], 'spreadsheet adapter', 'No bundled XLSX workbook adapter is installed.'),
    unavailableFormat('ods', 'OpenDocument Spreadsheet', ['ods'], 'spreadsheet adapter', 'No bundled ODS workbook adapter is installed.')
  ]),
  registryCategory('Code/Text', [
    ...['text', 'markdown', 'html'].map((id) => availableFormat(id, FORMATS[id].label, FORMATS[id].extensions, 'bundled converter core', ['convert'])),
    unavailableFormat('source-code', 'Source code', ['js', 'ts', 'py', 'go', 'rs'], 'language-aware adapter', 'No bundled language-aware source transformation adapter is installed.')
  ]),
  registryCategory('Binary Encodings', [
    ...['binary', 'base64', 'hex'].map((id) => availableFormat(id, FORMATS[id].label, FORMATS[id].extensions, 'Node.js Buffer', ['encode', 'decode']))
  ])
]);

function registryCategory(category, formats) {
  return Object.freeze({ category, formats: Object.freeze(formats) });
}

function availableFormat(id, label, extensions, dependency, capabilities) {
  return Object.freeze({ id, label, extensions: Object.freeze(extensions), status: 'available', bundled: true, adapter: id === 'pdf' ? 'pdf-lib' : 'local', dependency, reason: null, capabilities: Object.freeze(capabilities) });
}

function unavailableFormat(id, label, extensions, missingDependency, reason) {
  return Object.freeze({ id, label, extensions: Object.freeze(extensions), status: 'unavailable', bundled: false, adapter: null, missingDependency, reason, capabilities: Object.freeze([]) });
}

function getFormatRegistry() {
  return FORMAT_REGISTRY.map((category) => ({ ...category, formats: category.formats.map((format) => ({ ...format, extensions: [...format.extensions], capabilities: [...format.capabilities] })) }));
}

function getFlatFormatRegistry() {
  return getFormatRegistry().flatMap(({ category, formats }) => formats.map((format) => ({ ...format, category })));
}

class ConverterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConverterError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ConverterError(code, message);
}

function assertFormat(format, label = 'format') {
  if (typeof format !== 'string' || !Object.hasOwn(FORMATS, format)) fail('INVALID_FORMAT', `Choose a supported ${label}.`);
  return format;
}

function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    fail('INVALID_UTF8', 'The selected file is not valid UTF-8 text. Choose a binary representation instead.');
  }
}

function extensionFormat(fileName = '') {
  const extension = path.extname(String(fileName)).slice(1).toLowerCase();
  return EXTENSION_TO_FORMAT.get(extension) || null;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return sample.length > 0 && controls / sample.length > 0.02;
}

function detectFormat(buffer, fileName = '') {
  if (!Buffer.isBuffer(buffer)) fail('INVALID_INPUT', 'Converter input must be a byte buffer.');
  if (buffer.length > MAX_INPUT_BYTES) fail('INPUT_TOO_LARGE', `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  const extension = extensionFormat(fileName);
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return detection('pdf', extension, 'signature', extension && extension !== 'pdf');
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return detection('png', extension, 'signature', extension && extension !== 'png');
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return detection('jpeg', extension, 'signature', extension && extension !== 'jpeg');
  }
  if (looksBinary(buffer)) return detection('binary', extension, 'content', Boolean(extension && extension !== 'binary'));

  const text = decodeUtf8(buffer).replace(/^\uFEFF/, '');
  const trimmed = text.trim();
  let detected = null;
  let basis = 'extension';
  if (trimmed) {
    if (/^<!doctype\s+html\b|^<html\b/i.test(trimmed)) { detected = 'html'; basis = 'content'; }
    else if (/^(?:<\?xml\b[^>]*>\s*)?<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>\s*$/i.test(trimmed)) { detected = 'xml'; basis = 'content'; }
    else {
      try { JSON.parse(trimmed); detected = 'json'; basis = 'content'; } catch { /* continue */ }
    }
    if (!detected && trimmed.split(/\r?\n/).length > 1) {
      const lines = trimmed.split(/\r?\n/).filter(Boolean);
      if (lines.every((line) => { try { JSON.parse(line); return true; } catch { return false; } })) { detected = 'jsonl'; basis = 'content'; }
    }
    if (!detected && extension === 'base64' && isCanonicalBase64(trimmed)) detected = 'base64';
    if (!detected && extension === 'hex' && isCanonicalHex(trimmed)) detected = 'hex';
  }
  detected ||= extension || 'text';
  return detection(detected, extension, basis, Boolean(extension && detected !== extension));
}

function detection(format, extension, basis, extensionMismatch) {
  return {
    format: format || 'unknown',
    label: format ? FORMATS[format].label : 'Unsupported binary file',
    extensionFormat: extension,
    basis,
    extensionMismatch: Boolean(extensionMismatch),
    supported: Boolean(format)
  };
}

function availableConversions(sourceFormat) {
  const source = assertFormat(sourceFormat, 'source format');
  return CONVERSIONS[source].map((format) => ({ format, label: FORMATS[format].label, extension: FORMATS[format].extensions[0] }));
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === delimiter) { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) fail('MALFORMED_INPUT', 'The delimited file contains an unterminated quoted field.');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const width = rows[0].length;
  if (!width || rows.some((entry) => entry.length !== width)) fail('MALFORMED_INPUT', 'Every delimited row must contain the same number of fields.');
  const headers = rows[0].map((header, index) => header || `column${index + 1}`);
  if (new Set(headers).size !== headers.length) fail('MALFORMED_INPUT', 'Delimited column names must be unique.');
  return rows.slice(1).map((entry) => Object.fromEntries(headers.map((header, index) => [header, entry[index]])));
}

function quoteDelimited(value, delimiter) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeDelimited(value, delimiter) {
  if (!Array.isArray(value)) fail('UNSUPPORTED_SHAPE', 'CSV and TSV output requires an array of records.');
  if (!value.length) return '';
  if (value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) fail('UNSUPPORTED_SHAPE', 'CSV and TSV output requires an array of records.');
  const headers = [...new Set(value.flatMap((entry) => Object.keys(entry)))];
  return [headers.map((header) => quoteDelimited(header, delimiter)).join(delimiter), ...value.map((entry) => headers.map((header) => quoteDelimited(entry[header], delimiter)).join(delimiter))].join('\n') + '\n';
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (/^(?:null|~)$/i.test(trimmed)) return null;
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"')) { try { return JSON.parse(trimmed); } catch { fail('MALFORMED_INPUT', 'A quoted value is malformed.'); } }
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function parseYaml(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#/.test(line));
  if (!lines.length) return null;
  if (lines.some((line) => /^\s/.test(line))) fail('UNSUPPORTED_SHAPE', 'This local YAML converter supports top-level records and lists only; nested indentation is not accepted.');
  if (lines.every((line) => /^-\s+/.test(line))) return lines.map((line) => parseScalar(line.replace(/^-\s+/, '')));
  const result = {};
  for (const line of lines) {
    const match = line.match(/^([^:#][^:]*):\s*(.*)$/);
    if (!match) fail('MALFORMED_INPUT', 'The YAML file must contain top-level key-value pairs or a top-level list.');
    const key = match[1].trim();
    if (!key || Object.hasOwn(result, key)) fail('MALFORMED_INPUT', 'YAML keys must be non-empty and unique.');
    result[key] = parseScalar(match[2]);
  }
  return result;
}

function serializeYaml(value) {
  if (Array.isArray(value)) return value.map((entry) => `- ${serializeScalar(entry)}`).join('\n') + '\n';
  if (!value || typeof value !== 'object') return `${serializeScalar(value)}\n`;
  if (Object.values(value).some((entry) => entry && typeof entry === 'object')) fail('UNSUPPORTED_SHAPE', 'YAML output currently supports top-level scalar records and scalar lists.');
  return Object.entries(value).map(([key, entry]) => `${safeDataKey(key, 'YAML')}: ${serializeScalar(entry)}`).join('\n') + '\n';
}

function parseToml(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) fail('UNSUPPORTED_SHAPE', 'This local TOML converter supports top-level scalar keys only.');
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match || Object.hasOwn(result, match[1])) fail('MALFORMED_INPUT', 'The TOML file contains a malformed or duplicate key.');
    result[match[1]] = parseScalar(match[2]);
  }
  return result;
}

function serializeToml(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((entry) => entry && typeof entry === 'object')) fail('UNSUPPORTED_SHAPE', 'TOML output requires one top-level record containing scalar values.');
  return Object.entries(value).map(([key, entry]) => `${safeDataKey(key, 'TOML')} = ${serializeScalar(entry)}`).join('\n') + '\n';
}

function safeDataKey(key, format) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('UNSUPPORTED_SHAPE', `${format} output contains an unsupported key.`);
  return key;
}

function serializeScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function unescapeXml(value) { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

function serializeXml(value) {
  const node = (entry, name = 'value') => {
    safeDataKey(name, 'XML');
    if (entry === null) return `<${name} type="null"/>`;
    if (Array.isArray(entry)) return `<${name} type="array">${entry.map((item) => node(item, 'item')).join('')}</${name}>`;
    if (typeof entry === 'object') return `<${name} type="object">${Object.entries(entry).map(([key, child]) => node(child, key)).join('')}</${name}>`;
    return `<${name} type="${typeof entry}">${escapeXml(entry)}</${name}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${node(value, 'root')}\n`;
}

function parseXml(text) {
  const source = text.trim().replace(/^<\?xml\b[^>]*>\s*/i, '');
  let position = 0;
  function node() {
    const start = source.slice(position).match(/^<([A-Za-z_][\w.-]*)\s+type="(null|array|object|string|number|boolean)"\s*(\/?)>/);
    if (!start) fail('MALFORMED_INPUT', 'XML input must use the converter\'s typed element format without attributes beyond type.');
    const [, name, type, selfClosing] = start;
    position += start[0].length;
    if (selfClosing) return { name, value: null };
    if (type === 'array' || type === 'object') {
      const children = [];
      while (!source.startsWith(`</${name}>`, position)) {
        if (position >= source.length) fail('MALFORMED_INPUT', 'The XML document has an unclosed element.');
        children.push(node());
      }
      position += name.length + 3;
      if (type === 'array') return { name, value: children.map((child) => child.value) };
      const value = {};
      for (const child of children) {
        if (Object.hasOwn(value, child.name)) fail('MALFORMED_INPUT', 'XML object element names must be unique.');
        value[child.name] = child.value;
      }
      return { name, value };
    }
    const end = source.indexOf(`</${name}>`, position);
    if (end < 0) fail('MALFORMED_INPUT', 'The XML document has an unclosed element.');
    const raw = unescapeXml(source.slice(position, end));
    if (raw.includes('<')) fail('MALFORMED_INPUT', 'Scalar XML elements cannot contain nested markup.');
    position = end + name.length + 3;
    if (type === 'number' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) fail('MALFORMED_INPUT', 'An XML number is malformed.');
    if (type === 'boolean' && !/^(?:true|false)$/.test(raw)) fail('MALFORMED_INPUT', 'An XML boolean is malformed.');
    return { name, value: type === 'number' ? Number(raw) : type === 'boolean' ? raw === 'true' : raw };
  }
  const result = node();
  if (source.slice(position).trim()) fail('MALFORMED_INPUT', 'The XML document contains trailing content.');
  return result.value;
}

function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function markdownToHtml(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
    const heading = block.match(/^(#{1,6})\s+([\s\S]*)$/);
    if (heading) return `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`;
    return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
  });
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>Converted document</title></head><body>\n${blocks.join('\n')}\n</body></html>\n`;
}

function dataToHtml(value) { return `<!doctype html>\n<html><head><meta charset="utf-8"><title>Converted data</title></head><body><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></body></html>\n`; }
function dataToMarkdown(value) { return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`; }

function isCanonicalBase64(value) {
  const compact = value.replace(/\s/g, '');
  return compact.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact);
}
function isCanonicalHex(value) { return value.replace(/\s/g, '').length % 2 === 0 && /^[0-9a-fA-F]*$/.test(value.replace(/\s/g, '')); }

function parseData(buffer, sourceFormat) {
  const text = decodeUtf8(buffer).replace(/^\uFEFF/, '');
  try {
    if (sourceFormat === 'json') return JSON.parse(text);
    if (sourceFormat === 'jsonl') return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch { fail('MALFORMED_INPUT', `The ${FORMATS[sourceFormat].label} input is malformed.`); }
  if (sourceFormat === 'yaml') return parseYaml(text);
  if (sourceFormat === 'toml') return parseToml(text);
  if (sourceFormat === 'xml') return parseXml(text);
  if (sourceFormat === 'csv') return parseDelimited(text, ',');
  if (sourceFormat === 'tsv') return parseDelimited(text, '\t');
  return text;
}

function encodeData(value, targetFormat) {
  if (targetFormat === 'json') return JSON.stringify(value, null, 2) + '\n';
  if (targetFormat === 'jsonl') {
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => JSON.stringify(entry)).join('\n') + (values.length ? '\n' : '');
  }
  if (targetFormat === 'yaml') return serializeYaml(value);
  if (targetFormat === 'toml') return serializeToml(value);
  if (targetFormat === 'xml') return serializeXml(value);
  if (targetFormat === 'csv') return serializeDelimited(value, ',');
  if (targetFormat === 'tsv') return serializeDelimited(value, '\t');
  if (targetFormat === 'html') return dataToHtml(value);
  if (targetFormat === 'markdown') return dataToMarkdown(value);
  fail('UNSUPPORTED_CONVERSION', 'That data conversion is not supported.');
}

function convertBuffer(buffer, { sourceFormat = 'auto', targetFormat, fileName = '', nativeImage = null } = {}) {
  if (!Buffer.isBuffer(buffer)) fail('INVALID_INPUT', 'Converter input must be a byte buffer.');
  if (buffer.length > MAX_INPUT_BYTES) fail('INPUT_TOO_LARGE', `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  const detected = detectFormat(buffer, fileName);
  const source = sourceFormat === 'auto' ? detected.format : assertFormat(sourceFormat, 'source format');
  const target = assertFormat(targetFormat, 'output format');
  if (!Object.hasOwn(CONVERSIONS, source) || !CONVERSIONS[source].includes(target)) fail('UNSUPPORTED_CONVERSION', `Conversion from ${detected.label} to ${FORMATS[target].label} is unsupported or would be lossy.`);
  let output;
  if (source === target) output = Buffer.from(buffer);
  else if (source === 'jpeg' && target === 'png') {
    if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') fail('IMAGE_BACKEND_UNAVAILABLE', 'The native image converter is unavailable.');
    const image = nativeImage.createFromBuffer(buffer);
    if (!image || image.isEmpty()) fail('MALFORMED_INPUT', 'The selected image could not be decoded.');
    output = image.toPNG();
    if (!Buffer.isBuffer(output) || !output.length) fail('CONVERSION_FAILED', 'The native image converter did not produce PNG data.');
  } else if (source === 'base64' || source === 'hex') {
    const text = decodeUtf8(buffer).trim();
    if (source === 'base64' && !isCanonicalBase64(text)) fail('MALFORMED_INPUT', 'The Base64 input is malformed.');
    if (source === 'hex' && !isCanonicalHex(text)) fail('MALFORMED_INPUT', 'The hexadecimal input is malformed.');
    const bytes = Buffer.from(text.replace(/\s/g, ''), source === 'base64' ? 'base64' : 'hex');
    if (target === 'text') { decodeUtf8(bytes); output = bytes; }
    else if (target === 'binary') output = bytes;
    else output = Buffer.from(target === 'base64' ? bytes.toString('base64') + '\n' : bytes.toString('hex') + '\n', 'utf8');
  } else if (target === 'base64' || target === 'hex') {
    output = Buffer.from(target === 'base64' ? buffer.toString('base64') + '\n' : buffer.toString('hex') + '\n', 'utf8');
  } else if (source === 'text' && target === 'markdown') output = Buffer.from(decodeUtf8(buffer), 'utf8');
  else if (source === 'markdown' && target === 'text') output = Buffer.from(decodeUtf8(buffer), 'utf8');
  else if (source === 'markdown' && target === 'html') output = Buffer.from(markdownToHtml(decodeUtf8(buffer)), 'utf8');
  else if (source === 'html' && target === 'text') {
    const html = decodeUtf8(buffer);
    if (/<(?:script|style|svg|math)\b/i.test(html)) fail('UNSUPPORTED_CONVERSION', 'HTML containing active or styled content cannot be converted to plain text without losing meaning.');
    output = Buffer.from(html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&'), 'utf8');
  } else {
    const value = parseData(buffer, source);
    output = Buffer.from(encodeData(value, target), 'utf8');
  }
  if (output.length > MAX_OUTPUT_BYTES) fail('OUTPUT_TOO_LARGE', `The converted file exceeds the ${MAX_OUTPUT_BYTES}-byte output limit.`);
  return { buffer: output, sourceFormat: source, targetFormat: target, sourceBytes: buffer.length, outputBytes: output.length, detected };
}

function previewConversion(result) {
  const textOutput = !['binary', 'pdf', 'png', 'jpeg'].includes(result.targetFormat);
  const preview = textOutput ? decodeUtf8(result.buffer).slice(0, MAX_PREVIEW_CHARS) : null;
  return {
    sourceFormat: result.sourceFormat,
    targetFormat: result.targetFormat,
    sourceBytes: result.sourceBytes,
    outputBytes: result.outputBytes,
    truncated: Boolean(preview && preview.length === MAX_PREVIEW_CHARS && result.outputBytes > Buffer.byteLength(preview)),
    preview,
    binary: !textOutput
  };
}

async function readBounded(filePath, io = fs) {
  let stat;
  try { stat = await io.stat(filePath); } catch { fail('READ_FAILED', 'The selected input file could not be read.'); }
  if (!stat.isFile()) fail('INVALID_INPUT', 'The selected input must be a regular file.');
  if (stat.size > MAX_INPUT_BYTES) fail('INPUT_TOO_LARGE', `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  try {
    const buffer = await io.readFile(filePath);
    if (buffer.length > MAX_INPUT_BYTES) fail('INPUT_TOO_LARGE', `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
    return buffer;
  } catch (error) {
    if (error instanceof ConverterError) throw error;
    fail('READ_FAILED', 'The selected input file could not be read.');
  }
}

function outputName(inputName, targetFormat) {
  const base = path.basename(inputName, path.extname(inputName)).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160) || 'converted';
  return `${base}.${FORMATS[targetFormat].extensions[0]}`;
}

function validateDestination(rootPath, candidatePath) {
  if (typeof rootPath !== 'string' || typeof candidatePath !== 'string' || rootPath.includes('\0') || candidatePath.includes('\0')) fail('INVALID_DESTINATION', 'The selected destination is invalid.');
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('DESTINATION_OUTSIDE_SELECTION', 'The output file must stay inside the selected destination folder.');
  return candidate;
}

async function validateDestinationFilesystem(rootPath, candidatePath, io = fs) {
  const root = path.resolve(rootPath);
  const candidate = validateDestination(root, candidatePath);
  if (typeof io.lstat !== 'function') return candidate;
  let rootStat;
  try { rootStat = await io.lstat(root); } catch { fail('INVALID_DESTINATION', 'The selected destination folder is unavailable.'); }
  if (rootStat.isSymbolicLink?.() || (typeof rootStat.isDirectory === 'function' && !rootStat.isDirectory())) fail('UNSAFE_DESTINATION', 'The selected destination must be a real local folder, not a symbolic link or reparse point.');
  const relative = path.relative(root, path.dirname(candidate));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await io.lstat(current);
      if (stat.isSymbolicLink?.() || (typeof stat.isDirectory === 'function' && !stat.isDirectory())) fail('UNSAFE_DESTINATION', 'The output path contains a symbolic link, reparse point, or non-folder ancestor.');
    } catch (error) {
      if (error instanceof ConverterError) throw error;
      if (!error || error.code !== 'ENOENT') throw error;
      break;
    }
  }
  return candidate;
}

async function writeGuarded(rootPath, candidatePath, buffer, { overwrite = false, io = fs } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_OUTPUT_BYTES) fail('OUTPUT_TOO_LARGE', `The converted file exceeds the ${MAX_OUTPUT_BYTES}-byte output limit.`);
  const destination = await validateDestinationFilesystem(rootPath, candidatePath, io);
  try {
    if (typeof io.lstat === 'function') {
      try {
        const existing = await io.lstat(destination);
        if (existing.isSymbolicLink()) fail('UNSAFE_DESTINATION', 'The selected output is a symbolic link and cannot be overwritten.');
      } catch (error) {
        if (error instanceof ConverterError) throw error;
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
    await io.writeFile(destination, buffer, { flag: overwrite ? 'w' : 'wx' });
    return destination;
  } catch (error) {
    if (error instanceof ConverterError) throw error;
    if (error && error.code === 'EEXIST') fail('OUTPUT_EXISTS', 'The destination already contains a file with that name. Explicit overwrite confirmation is required.');
    fail('WRITE_FAILED', 'The converted file could not be written to the selected destination.');
  }
}

const PDF_OPERATIONS = Object.freeze(['inspect', 'split', 'merge', 'extract-pages', 'reorder', 'rotate', 'edit-metadata']);
const MAX_PDF_PAGES = 512;
const MAX_PDF_OUTPUTS = 512;
const PDF_METADATA_FIELDS = Object.freeze(['title', 'author', 'subject', 'keywords', 'creator', 'producer']);

function assertPdfOperation(operation) {
  if (typeof operation !== 'string' || !PDF_OPERATIONS.includes(operation)) fail('INVALID_PDF_OPERATION', 'Choose a supported PDF operation.');
  return operation;
}

function assertPdfBytes(buffer) {
  if (!Buffer.isBuffer(buffer)) fail('INVALID_INPUT', 'PDF input must be a byte buffer.');
  if (buffer.length > MAX_INPUT_BYTES) fail('INPUT_TOO_LARGE', `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') fail('MALFORMED_PDF', 'The selected file is not a valid PDF document.');
}

async function loadPdf(buffer) {
  assertPdfBytes(buffer);
  try {
    const document = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: true });
    if (document.getPageCount() < 1 || document.getPageCount() > MAX_PDF_PAGES) fail('PDF_PAGE_LIMIT', `PDF documents must contain between 1 and ${MAX_PDF_PAGES} pages.`);
    return document;
  } catch (error) {
    if (error instanceof ConverterError) throw error;
    fail('MALFORMED_PDF', 'The selected PDF document is malformed or unsupported.');
  }
}

function pageIndex(value, pageCount, name = 'Page number') {
  if (!Number.isInteger(value) || value < 1 || value > pageCount) fail('PDF_PAGE_OUT_OF_BOUNDS', `${name} must be between 1 and ${pageCount}.`);
  return value - 1;
}

function pageList(value, pageCount, { unique = true, complete = false, name = 'Pages' } = {}) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PDF_PAGES) fail('INVALID_PDF_PAGES', `${name} must be a non-empty bounded list.`);
  const indexes = value.map((entry) => pageIndex(entry, pageCount, name));
  if (unique && new Set(indexes).size !== indexes.length) fail('INVALID_PDF_PAGES', `${name} must not contain duplicates.`);
  if (complete && (indexes.length !== pageCount || new Set(indexes).size !== pageCount)) fail('INVALID_PDF_ORDER', 'Reorder must include every page exactly once.');
  return indexes;
}

function normalizedRotation(value) {
  if (!Number.isInteger(value) || value % 90 !== 0 || Math.abs(value) > 3600) fail('INVALID_PDF_ROTATION', 'Rotation must be a whole multiple of 90 degrees.');
  return ((value % 360) + 360) % 360;
}

function boundedPdfName(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || !value || value.length > 180 || value.includes('\0') || /[\\/:*?"<>]/.test(value) || value === '.' || value === '..') fail('INVALID_OUTPUT_NAME', 'PDF output names must be safe file names without path separators.');
  return value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`;
}

function pdfMetadata(document) {
  return {
    title: document.getTitle() || '', author: document.getAuthor() || '', subject: document.getSubject() || '',
    keywords: document.getKeywords() || '', creator: document.getCreator() || '', producer: document.getProducer() || ''
  };
}

function pdfPageState(document) {
  return document.getPages().map((page) => {
    const size = page.getSize();
    return { width: size.width, height: size.height, rotation: normalizedRotation(page.getRotation().angle), contentFingerprint: pdfPageFingerprint(document, page) };
  });
}

function pdfPageFingerprint(document, page) {
  const hash = crypto.createHash('sha256');
  const contents = page.node.Contents();
  const entries = contents?.asArray ? contents.asArray() : contents ? [contents] : [];
  for (const entry of entries) {
    try {
      const stream = document.context.lookup(entry);
      if (stream && typeof stream.getContents === 'function') hash.update(Buffer.from(stream.getContents()));
      else hash.update(String(entry));
    } catch { hash.update(String(entry)); }
  }
  return hash.digest('hex');
}

function pdfRange(value, pageCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['start', 'end'].includes(key))) fail('INVALID_PDF_PAGES', 'Each split range must contain only start and end page numbers.');
  const start = pageIndex(value.start, pageCount, 'Split range start');
  const end = pageIndex(value.end, pageCount, 'Split range end');
  if (start > end) fail('INVALID_PDF_PAGES', 'A split range start must not come after its end.');
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

async function inspectPdfBuffer(buffer) {
  const document = await loadPdf(buffer);
  return { pageCount: document.getPageCount(), pages: pdfPageState(document), metadata: pdfMetadata(document), encrypted: false };
}

async function makePdfFromPages(source, indexes) {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, indexes);
  copied.forEach((page) => output.addPage(page));
  return output;
}

function metadataInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PDF_METADATA', 'PDF metadata must be a record.');
  const unknown = Object.keys(value).filter((key) => !PDF_METADATA_FIELDS.includes(key));
  if (unknown.length) fail('INVALID_PDF_METADATA', 'PDF metadata contains unsupported fields.');
  const result = {};
  for (const field of PDF_METADATA_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    if (typeof value[field] !== 'string' || value[field].length > 1024 || value[field].includes('\0')) fail('INVALID_PDF_METADATA', `PDF metadata field ${field} is invalid.`);
    result[field] = value[field];
  }
  return result;
}

function applyMetadata(document, metadata) {
  const methods = { title: 'setTitle', author: 'setAuthor', subject: 'setSubject', keywords: 'setKeywords', creator: 'setCreator', producer: 'setProducer' };
  for (const [field, value] of Object.entries(metadata)) document[methods[field]](field === 'keywords' ? [value] : value);
}

async function verifiedPdfOutput(document, expected) {
  let buffer;
  try { buffer = Buffer.from(await document.save({ useObjectStreams: false })); } catch { fail('PDF_WRITE_FAILED', 'The PDF output could not be encoded.'); }
  if (buffer.length > MAX_OUTPUT_BYTES) fail('OUTPUT_TOO_LARGE', `The converted file exceeds the ${MAX_OUTPUT_BYTES}-byte output limit.`);
  const reopened = await loadPdf(buffer);
  const actualPages = pdfPageState(reopened);
  if (actualPages.length !== expected.pages.length || actualPages.some((page, index) => page.width !== expected.pages[index].width || page.height !== expected.pages[index].height || page.rotation !== expected.pages[index].rotation || page.contentFingerprint !== expected.pages[index].contentFingerprint)) {
    fail('PDF_VALIDATION_FAILED', 'The written PDF failed page count, order, or rotation validation.');
  }
  if (expected.metadata) {
    const actual = pdfMetadata(reopened);
    for (const [field, value] of Object.entries(expected.metadata)) if (actual[field] !== value) fail('PDF_VALIDATION_FAILED', 'The written PDF failed metadata validation.');
  }
  return buffer;
}

async function executePdfOperation({ operation, inputs, options = {} } = {}) {
  const selectedOperation = assertPdfOperation(operation);
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_PDF_OPTIONS', 'PDF options must be a record.');
  const allowedOptions = {
    inspect: [], split: ['ranges', 'outputNames'], merge: ['outputName'], 'extract-pages': ['pages', 'outputName'],
    reorder: ['pageOrder', 'outputName'], rotate: ['pages', 'angle', 'outputName'], 'edit-metadata': ['metadata', 'outputName']
  };
  if (Object.keys(options).some((key) => !allowedOptions[selectedOperation].includes(key))) fail('INVALID_PDF_OPTIONS', 'PDF options contain unsupported fields for this operation.');
  if (selectedOperation === 'inspect') {
    if (!Array.isArray(inputs) || !inputs.length || inputs.some((input) => !input || !Buffer.isBuffer(input.buffer))) fail('INVALID_PDF_INPUTS', 'Choose one or more PDF inputs to inspect.');
    if (inputs.reduce((total, input) => total + input.buffer.length, 0) > MAX_PDF_AGGREGATE_INPUT_BYTES) fail('PDF_INPUT_BYTES_LIMIT', `Selected PDF inputs exceed the ${MAX_PDF_AGGREGATE_INPUT_BYTES}-byte aggregate limit.`);
    const inspections = [];
    for (const input of inputs) inspections.push({ name: input.name, ...(await inspectPdfBuffer(input.buffer)) });
    return { operation: selectedOperation, inspection: inspections.length === 1 ? inspections[0] : null, inspections };
  }
  if (selectedOperation !== 'split' && Array.isArray(options.outputNames)) fail('INVALID_PDF_OPTIONS', 'Multiple PDF output names are supported only for split operations.');
  if (!Array.isArray(inputs) || !inputs.length || inputs.some((input) => !input || !Buffer.isBuffer(input.buffer))) fail('INVALID_PDF_INPUTS', 'Choose one or more PDF inputs.');
  if (inputs.reduce((total, input) => total + input.buffer.length, 0) > MAX_PDF_AGGREGATE_INPUT_BYTES) fail('PDF_INPUT_BYTES_LIMIT', `Selected PDF inputs exceed the ${MAX_PDF_AGGREGATE_INPUT_BYTES}-byte aggregate limit.`);
  if (selectedOperation !== 'merge' && inputs.length !== 1) fail('INVALID_PDF_INPUTS', 'This PDF operation requires exactly one input.');
  const documents = [];
  for (const input of inputs) documents.push(await loadPdf(input.buffer));
  const outputs = [];
  if (selectedOperation === 'split') {
    const source = documents[0];
    if (options.ranges != null && (!Array.isArray(options.ranges) || !options.ranges.length || options.ranges.length > MAX_PDF_OUTPUTS)) fail('INVALID_PDF_PAGES', 'Split ranges must be a non-empty bounded list.');
    if (options.outputNames != null && (!Array.isArray(options.outputNames) || options.outputNames.length !== (options.ranges?.length || source.getPageCount()))) fail('INVALID_OUTPUT_NAME', 'Split output names must match the number of split documents.');
    const groups = options.ranges == null ? Array.from({ length: source.getPageCount() }, (_, index) => [index]) : options.ranges.map((range) => pdfRange(range, source.getPageCount()));
    if (!groups.length || groups.length > MAX_PDF_OUTPUTS) fail('INVALID_PDF_PAGES', 'Split ranges must be a non-empty bounded list.');
    for (let index = 0; index < groups.length; index += 1) {
      const output = await makePdfFromPages(source, groups[index]);
      const expectedPages = groups[index].map((page) => pdfPageState(source)[page]);
      outputs.push({ name: boundedPdfName(options.outputNames?.[index], `split-${index + 1}.pdf`), buffer: await verifiedPdfOutput(output, { pages: expectedPages }) });
    }
  } else if (selectedOperation === 'merge') {
    const output = await PDFDocument.create();
    const expectedPages = [];
    for (const source of documents) {
      const indexes = source.getPageIndices();
      const copied = await output.copyPages(source, indexes);
      copied.forEach((page) => output.addPage(page));
      expectedPages.push(...pdfPageState(source));
    }
    outputs.push({ name: boundedPdfName(options.outputName, 'merged.pdf'), buffer: await verifiedPdfOutput(output, { pages: expectedPages }) });
  } else if (selectedOperation === 'extract-pages' || selectedOperation === 'reorder') {
    const source = documents[0];
    const indexes = pageList(selectedOperation === 'reorder' ? options.pageOrder : options.pages, source.getPageCount(), { complete: selectedOperation === 'reorder', name: selectedOperation === 'reorder' ? 'Page order' : 'Extracted pages' });
    const output = await makePdfFromPages(source, indexes);
    outputs.push({ name: boundedPdfName(options.outputName, selectedOperation === 'reorder' ? 'reordered.pdf' : 'extracted.pdf'), buffer: await verifiedPdfOutput(output, { pages: indexes.map((index) => pdfPageState(source)[index]) }) });
  } else if (selectedOperation === 'rotate') {
    const source = documents[0];
    const pages = pageList(options.pages, source.getPageCount(), { name: 'Rotated pages' });
    const angle = normalizedRotation(options.angle);
    for (const index of pages) source.getPage(index).setRotation(degrees(normalizedRotation(source.getPage(index).getRotation().angle + angle)));
    outputs.push({ name: boundedPdfName(options.outputName, 'rotated.pdf'), buffer: await verifiedPdfOutput(source, { pages: pdfPageState(source) }) });
  } else if (selectedOperation === 'edit-metadata') {
    const source = documents[0];
    const metadata = metadataInput(options.metadata);
    applyMetadata(source, metadata);
    outputs.push({ name: boundedPdfName(options.outputName, 'metadata.pdf'), buffer: await verifiedPdfOutput(source, { pages: pdfPageState(source), metadata }) });
  }
  if (new Set(outputs.map((output) => output.name.toLowerCase())).size !== outputs.length) fail('DUPLICATE_OUTPUT_NAME', 'Every PDF output must have a unique file name.');
  return { operation: selectedOperation, outputs };
}

async function writePdfAtomic(rootPath, candidatePath, buffer, { overwrite = false, io = fs } = {}) {
  const destination = await validateDestinationFilesystem(rootPath, candidatePath, io);
  const temporary = validateDestination(rootPath, path.join(rootPath, `.${path.basename(destination)}.${crypto.randomBytes(12).toString('hex')}.tmp`));
  const backup = validateDestination(rootPath, path.join(rootPath, `.${path.basename(destination)}.${crypto.randomBytes(12).toString('hex')}.bak`));
  let backedUp = false;
  try {
    if (typeof io.lstat === 'function') {
      const root = await io.lstat(path.resolve(rootPath));
      if (!root.isDirectory() || root.isSymbolicLink()) fail('UNSAFE_DESTINATION', 'The selected PDF destination must be a real local folder, not a symbolic link.');
      try {
        const existing = await io.lstat(destination);
        if (existing.isSymbolicLink() || !existing.isFile()) fail('UNSAFE_DESTINATION', 'The selected PDF output cannot replace a symbolic link or non-file entry.');
        if (!overwrite) fail('OUTPUT_EXISTS', 'The destination already contains a file with that name. Explicit overwrite confirmation is required.');
      } catch (error) { if (error instanceof ConverterError) throw error; if (!error || error.code !== 'ENOENT') throw error; }
    }
    await io.writeFile(temporary, buffer, { flag: 'wx' });
    if (overwrite) {
      try { await io.rename(destination, backup); backedUp = true; }
      catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
    }
    await io.rename(temporary, destination);
    if (backedUp && typeof io.unlink === 'function') await io.unlink(backup);
    return destination;
  } catch (error) {
    try { if (typeof io.unlink === 'function') await io.unlink(temporary); } catch { /* best-effort cleanup */ }
    if (backedUp) {
      try { await io.rename(backup, destination); } catch { /* preserve stable public error */ }
    }
    if (error instanceof ConverterError) throw error;
    if (error && ['EEXIST', 'EPERM'].includes(error.code) && !overwrite) fail('OUTPUT_EXISTS', 'The destination already contains a file with that name. Explicit overwrite confirmation is required.');
    fail('WRITE_FAILED', 'The PDF file could not be written atomically to the selected destination.');
  }
}

function createPersistentConversionQueue({ statePath, io = fs, nativeImage = null, concurrency = 2 } = {}) {
  if (typeof statePath !== 'string' || !statePath || statePath.includes('\0')) throw new TypeError('A queue state path is required.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TypeError('Queue concurrency must be between 1 and 8.');
  let state = { version: 1, paused: true, jobs: [] };
  let loaded = false;
  let running = null;
  let cancelRequested = false;
  let persistChain = Promise.resolve();
  const stateRoot = path.dirname(path.resolve(statePath));
  const resolvedStatePath = path.resolve(statePath);
  const recoveryStatePath = `${resolvedStatePath}.recovery`;
  const safeSnapshot = () => ({ version: state.version, paused: state.paused, jobs: state.jobs.map(({ sourcePath, destinationRoot, ...job }) => ({ ...job })) });
  function validateStoredJob(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid job.');
    const allowed = ['id', 'sourcePath', 'destinationRoot', 'inputName', 'outputName', 'sourceBytes', 'targetFormat', 'group', 'status', 'attempts', 'error', 'outputBytes'];
    if (Object.keys(job).some((key) => !allowed.includes(key))) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains unsupported job fields.');
    if (typeof job.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(job.id)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid job identifier.');
    for (const [key, limit] of [['sourcePath', 32768], ['destinationRoot', 32768], ['inputName', 260], ['outputName', 260], ['group', 80]]) {
      if (typeof job[key] !== 'string' || !job[key] || job[key].length > limit || job[key].includes('\0')) fail('QUEUE_STATE_INVALID', `The saved conversion queue contains an invalid ${key}.`);
    }
    if (path.resolve(job.sourcePath) !== job.sourcePath || path.resolve(job.destinationRoot) !== job.destinationRoot) fail('QUEUE_STATE_INVALID', 'Saved queue paths must be absolute and normalized.');
    if (path.basename(job.outputName) !== job.outputName || /[\\/:*?"<>]/.test(job.outputName)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an unsafe output name.');
    try { validateDestination(job.destinationRoot, path.join(job.destinationRoot, job.outputName)); } catch { fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid destination.'); }
    if (!Object.hasOwn(FORMATS, job.targetFormat)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid target format.');
    if (!['queued', 'running', 'converted', 'failed', 'cancelled'].includes(job.status)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid status.');
    if (!Number.isSafeInteger(job.sourceBytes) || job.sourceBytes < 0 || job.sourceBytes > MAX_INPUT_BYTES || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.attempts > 1000000) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains invalid numeric fields.');
    if (job.outputBytes != null && (!Number.isSafeInteger(job.outputBytes) || job.outputBytes < 0 || job.outputBytes > MAX_OUTPUT_BYTES)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains an invalid output size.');
    if (job.error != null && (!job.error || typeof job.error !== 'object' || Array.isArray(job.error) || typeof job.error.code !== 'string' || typeof job.error.message !== 'string' || job.error.code.length > 80 || job.error.message.length > 1000)) fail('QUEUE_STATE_INVALID', 'The saved conversion queue contains invalid error details.');
  }
  async function persist() {
    const snapshot = JSON.stringify(state);
    const operation = persistChain.then(async () => {
      await io.mkdir(stateRoot, { recursive: true });
      const temporary = path.join(stateRoot, `.${path.basename(statePath)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      await io.writeFile(temporary, snapshot, { flag: 'wx' });
      try { await io.rename(temporary, resolvedStatePath); }
      catch (error) {
        if (error?.code !== 'EPERM') throw error;
        await io.unlink(recoveryStatePath).catch((unlinkError) => { if (unlinkError?.code !== 'ENOENT') throw unlinkError; });
        await io.rename(resolvedStatePath, recoveryStatePath);
        try { await io.rename(temporary, resolvedStatePath); }
        catch (replacementError) { await io.rename(recoveryStatePath, resolvedStatePath).catch(() => {}); throw replacementError; }
        await io.unlink(recoveryStatePath).catch((unlinkError) => { if (unlinkError?.code !== 'ENOENT') throw unlinkError; });
      }
    });
    persistChain = operation.catch(() => {});
    return operation;
  }
  async function ensureLoaded() {
    if (loaded) return;
    try {
      let serialized;
      try { serialized = await io.readFile(resolvedStatePath, 'utf8'); }
      catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        serialized = await io.readFile(recoveryStatePath, 'utf8');
        await io.rename(recoveryStatePath, resolvedStatePath);
      }
      const parsed = JSON.parse(serialized);
      if (!parsed || parsed.version !== 1 || typeof parsed.paused !== 'boolean' || !Array.isArray(parsed.jobs) || parsed.jobs.length > MAX_QUEUE_JOBS || Object.keys(parsed).some((key) => !['version', 'paused', 'jobs'].includes(key))) fail('QUEUE_STATE_INVALID', 'The saved conversion queue is invalid.');
      parsed.jobs.forEach(validateStoredJob);
      state = parsed;
      state.paused = true;
      for (const job of state.jobs) if (job.status === 'running') job.status = 'queued';
      await persist();
      loaded = true;
    } catch (error) {
      if (error instanceof ConverterError) throw error;
      if (!error || error.code !== 'ENOENT') fail('QUEUE_STATE_INVALID', 'The saved conversion queue could not be loaded.');
      loaded = true;
    }
  }
  function normalizeRule(rule, name = 'Queue rule') {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) fail('INVALID_QUEUE_RULE', `${name} is invalid.`);
    const unknown = Object.keys(rule).filter((key) => !['targetFormat', 'group'].includes(key));
    if (unknown.length) fail('INVALID_QUEUE_RULE', `${name} contains unsupported fields.`);
    const targetFormat = assertFormat(rule.targetFormat, 'queue target format');
    const group = rule.group == null ? 'default' : String(rule.group);
    if (!group || group.length > 80 || group.includes('\0')) fail('INVALID_QUEUE_RULE', `${name} has an invalid group.`);
    return { targetFormat, group };
  }
  async function addPaths(paths, destinationRoot, rule, groupRules = {}) {
    await ensureLoaded();
    if (!Array.isArray(paths) || !paths.length) fail('INVALID_BATCH', 'Choose at least one input.');
    const baseRule = normalizeRule(rule);
    if (!groupRules || typeof groupRules !== 'object' || Array.isArray(groupRules)) fail('INVALID_QUEUE_RULE', 'Per-group rules must be a record.');
    const normalizedGroups = Object.fromEntries(Object.entries(groupRules).map(([group, value]) => [group, normalizeRule({ ...value, group }, `Rule for group ${group}`)]));
    const root = path.resolve(destinationRoot);
    await validateDestinationFilesystem(root, path.join(root, '.conversion-preflight'), io);
    const added = [];
    for (let offset = 0; offset < paths.length; offset += 128) {
      const chunk = paths.slice(offset, offset + 128);
      if (state.jobs.length + chunk.length > MAX_QUEUE_JOBS) fail('QUEUE_LIMIT', `The persistent queue supports at most ${MAX_QUEUE_JOBS} jobs.`);
      for (const sourcePath of chunk) {
      const source = path.resolve(sourcePath);
      const stat = await (typeof io.lstat === 'function' ? io.lstat(source) : io.stat(source)).catch(() => null);
      if (stat?.isSymbolicLink?.()) { added.push({ name: path.basename(source), status: 'failed', error: { code: 'UNSAFE_INPUT', message: 'Symbolic-link and reparse-point inputs are not accepted.' } }); continue; }
      if (!stat?.isFile()) { added.push({ name: path.basename(source), status: 'failed', error: { code: 'READ_FAILED', message: 'The selected input file could not be read.' } }); continue; }
      if (stat.size > MAX_INPUT_BYTES) { added.push({ name: path.basename(source), status: 'failed', error: { code: 'INPUT_TOO_LARGE', message: `The selected file exceeds the ${MAX_INPUT_BYTES}-byte input limit.` } }); continue; }
      const applied = normalizedGroups[baseRule.group] || baseRule;
      const output = outputName(path.basename(source), applied.targetFormat);
      validateDestination(root, path.join(root, output));
      const job = { id: crypto.randomUUID(), sourcePath: source, destinationRoot: root, inputName: path.basename(source), outputName: output, sourceBytes: stat.size, targetFormat: applied.targetFormat, group: applied.group, status: 'queued', attempts: 0, error: null, outputBytes: null };
      state.jobs.push(job);
      added.push({ id: job.id, name: job.inputName, outputName: job.outputName, status: job.status, group: job.group });
      }
      await persist();
    }
    return added;
  }
  async function collectFolder(folderPath, { recursive = true, extensions = [] } = {}) {
    const result = [];
    const allowed = new Set(extensions.map((entry) => String(entry).replace(/^\./, '').toLowerCase()));
    const pending = [path.resolve(folderPath)];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      if (typeof io.lstat === 'function') {
        let folderStat;
        try { folderStat = await io.lstat(current); } catch { fail('READ_FAILED', 'The selected folder could not be read.'); }
        if (folderStat.isSymbolicLink?.() || (typeof folderStat.isDirectory === 'function' && !folderStat.isDirectory())) fail('UNSAFE_INPUT', 'Folder intake does not traverse symbolic links, reparse points, or non-folder ancestors.');
      }
      try { entries = await io.readdir(current, { withFileTypes: true }); } catch { fail('READ_FAILED', 'The selected folder could not be read.'); }
      for (const entry of entries) {
        const candidate = path.join(current, entry.name);
        if (entry.isSymbolicLink?.()) continue;
        if (entry.isDirectory?.() && recursive) pending.push(candidate);
        else if (entry.isFile?.() && (!allowed.size || allowed.has(path.extname(entry.name).slice(1).toLowerCase()))) result.push(candidate);
      }
    }
    return result;
  }
  async function preflight() {
    await ensureLoaded();
    const queued = state.jobs.filter((job) => ['queued', 'failed'].includes(job.status));
    const byRoot = new Map();
    for (const job of queued) byRoot.set(job.destinationRoot, (byRoot.get(job.destinationRoot) || 0) + Math.min(MAX_OUTPUT_BYTES, Math.max(job.sourceBytes * 2, 1024)));
    const roots = [];
    for (const [root, requiredBytes] of byRoot) {
      await validateDestinationFilesystem(root, path.join(root, '.conversion-preflight'), io);
      let availableBytes = null;
      if (typeof io.statfs === 'function') {
        try { const info = await io.statfs(root); availableBytes = Number(info.bavail) * Number(info.bsize); } catch { /* reported as unknown */ }
      }
      if (availableBytes != null && availableBytes < requiredBytes) fail('INSUFFICIENT_STORAGE', 'The selected destination does not have enough available storage for the queued conversions.');
      roots.push({ name: path.basename(root) || 'destination', requiredBytes, availableBytes });
    }
    return { queued: queued.length, roots };
  }
  async function processJob(job) {
    if (cancelRequested || state.paused) return;
    job.status = 'running'; job.attempts += 1; job.error = null; await persist();
    try {
      const buffer = await readBounded(job.sourcePath, io);
      const converted = convertBuffer(buffer, { sourceFormat: 'auto', targetFormat: job.targetFormat, fileName: job.inputName, nativeImage });
      await writeGuarded(job.destinationRoot, path.join(job.destinationRoot, job.outputName), converted.buffer, { overwrite: false, io });
      job.status = 'converted'; job.outputBytes = converted.outputBytes;
    } catch (error) { job.status = cancelRequested ? 'queued' : 'failed'; job.error = cancelRequested ? null : publicError(error); }
    await persist();
  }
  async function drain() {
    await preflight();
    state.paused = false; cancelRequested = false; await persist();
    while (!state.paused && !cancelRequested) {
      const pending = state.jobs.filter((job) => job.status === 'queued').slice(0, concurrency);
      if (!pending.length) break;
      await Promise.all(pending.map(processJob));
    }
    if (cancelRequested) state.paused = true;
    await persist();
    return safeSnapshot();
  }
  return Object.freeze({
    async snapshot() { await ensureLoaded(); return safeSnapshot(); },
    async enqueue({ paths, destinationRoot, rule, groupRules }) { return addPaths(paths, destinationRoot, rule, groupRules); },
    async enqueueFolder({ folderPath, destinationRoot, rule, groupRules, recursive = true, extensions = [] }) { return addPaths(await collectFolder(folderPath, { recursive, extensions }), destinationRoot, rule, groupRules); },
    preflight,
    async start() { await ensureLoaded(); if (!running) running = drain().finally(() => { running = null; }); return { started: true, snapshot: safeSnapshot() }; },
    async resume() { await ensureLoaded(); if (!running) running = drain().finally(() => { running = null; }); return running; },
    async pause() { await ensureLoaded(); state.paused = true; await persist(); return safeSnapshot(); },
    async cancel() { await ensureLoaded(); cancelRequested = true; state.paused = true; for (const job of state.jobs) if (job.status === 'queued') job.status = 'cancelled'; await persist(); return safeSnapshot(); },
    async retry({ jobIds = null } = {}) { await ensureLoaded(); const selected = jobIds == null ? null : new Set(jobIds); for (const job of state.jobs) if (['failed', 'cancelled'].includes(job.status) && (!selected || selected.has(job.id))) { job.status = 'queued'; job.error = null; } await persist(); return safeSnapshot(); }
  });
}

function createConverterService({ dialog, nativeImage = null, io = fs, ownerWindow = () => null, queueStatePath = null, queueConcurrency = 2 } = {}) {
  if (!dialog || typeof dialog.showOpenDialog !== 'function' || typeof dialog.showSaveDialog !== 'function') throw new TypeError('A native dialog implementation is required.');
  const inputs = new Map();
  const destinations = new Map();
  const folders = new Map();
  const pdfPlans = new Map();
  const queue = queueStatePath ? createPersistentConversionQueue({ statePath: queueStatePath, io, nativeImage, concurrency: queueConcurrency }) : null;
  const token = () => crypto.randomBytes(24).toString('base64url');
  function prunePdfPlans(now = Date.now()) {
    for (const [planToken, plan] of pdfPlans) if (now - plan.createdAt > PDF_PLAN_TTL_MS) pdfPlans.delete(planToken);
    while (pdfPlans.size >= MAX_PDF_PLANS) pdfPlans.delete(pdfPlans.keys().next().value);
  }
  const inputFor = (inputToken) => {
    if (typeof inputToken !== 'string' || inputToken.length > 64 || !inputs.has(inputToken)) fail('UNKNOWN_SELECTION', 'Select the input file again.');
    return inputs.get(inputToken);
  };
  const destinationFor = (destinationToken) => {
    if (typeof destinationToken !== 'string' || destinationToken.length > 64 || !destinations.has(destinationToken)) fail('UNKNOWN_DESTINATION', 'Select the destination folder again.');
    return destinations.get(destinationToken);
  };
  const folderFor = (folderToken) => {
    if (typeof folderToken !== 'string' || folderToken.length > 64 || !folders.has(folderToken)) fail('UNKNOWN_SELECTION', 'Select the source folder again.');
    return folders.get(folderToken);
  };
  async function registerInput(filePath) {
    const buffer = await readBounded(filePath, io);
    const inputToken = token();
    const detected = detectFormat(buffer, path.basename(filePath));
    const fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
    inputs.set(inputToken, { path: path.resolve(filePath), name: path.basename(filePath), detected, fingerprint });
    return { inputToken, name: path.basename(filePath), sizeBytes: buffer.length, detected, conversions: detected.supported ? availableConversions(detected.format) : [] };
  }
  async function selectInputs({ multiple = false } = {}) {
    const result = await dialog.showOpenDialog(ownerWindow(), { title: multiple ? 'Select files to convert' : 'Select a file to convert', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
    if (result.canceled) return [];
    if (!Array.isArray(result.filePaths) || result.filePaths.length > MAX_BATCH_ITEMS) fail('BATCH_TOO_LARGE', `Select no more than ${MAX_BATCH_ITEMS} files at once.`);
    const selections = [];
    for (const filePath of result.filePaths) selections.push(await registerInput(filePath));
    return selections;
  }
  async function convert(inputToken, targetFormat) {
    const input = inputFor(inputToken);
    const buffer = await readBounded(input.path, io);
    const fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
    if (fingerprint !== input.fingerprint) fail('INPUT_CHANGED', 'The selected input changed after it was inspected. Select it again before converting.');
    return convertBuffer(buffer, { sourceFormat: 'auto', targetFormat, fileName: input.name, nativeImage });
  }
  async function pdfInputBuffers(inputTokens) {
    if (!Array.isArray(inputTokens) || !inputTokens.length || new Set(inputTokens).size !== inputTokens.length) fail('INVALID_PDF_INPUTS', 'Choose one or more unique PDF inputs.');
    const values = [];
    let aggregateBytes = 0;
    for (const inputToken of inputTokens) {
      const input = inputFor(inputToken);
      const buffer = await readBounded(input.path, io);
      const fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
      if (fingerprint !== input.fingerprint) fail('INPUT_CHANGED', 'A selected PDF changed after it was inspected. Select it again before continuing.');
      if (detectFormat(buffer, input.name).format !== 'pdf') fail('MALFORMED_PDF', 'Every selected PDF tool input must be a valid PDF document.');
      aggregateBytes += buffer.length;
      if (aggregateBytes > MAX_PDF_AGGREGATE_INPUT_BYTES) fail('PDF_INPUT_BYTES_LIMIT', `Selected PDF inputs exceed the ${MAX_PDF_AGGREGATE_INPUT_BYTES}-byte aggregate limit.`);
      values.push({ inputToken, name: input.name, buffer });
    }
    return values;
  }
  return Object.freeze({
    getFormatRegistry: getFlatFormatRegistry,
    async selectInput() { return (await selectInputs({ multiple: false }))[0] || null; },
    selectBatchInputs() { return selectInputs({ multiple: true }); },
    inspect({ inputToken }) { const input = inputFor(inputToken); return { name: input.name, detected: input.detected, conversions: input.detected.supported ? availableConversions(input.detected.format) : [] }; },
    async preview({ inputToken, targetFormat }) { return previewConversion(await convert(inputToken, targetFormat)); },
    async save({ inputToken, targetFormat, confirmOverwrite = false }) {
      const input = inputFor(inputToken);
      const target = assertFormat(targetFormat, 'output format');
      const result = await convert(inputToken, target);
      const save = await dialog.showSaveDialog(ownerWindow(), { title: 'Save converted file', defaultPath: outputName(input.name, target), filters: [{ name: FORMATS[target].label, extensions: FORMATS[target].extensions }] });
      if (save.canceled || !save.filePath) return null;
      const destination = path.resolve(save.filePath);
      await writeGuarded(path.dirname(destination), destination, result.buffer, { overwrite: confirmOverwrite, io });
      return { name: path.basename(destination), bytes: result.outputBytes, sourceFormat: result.sourceFormat, targetFormat: result.targetFormat };
    },
    async selectDestination() {
      const result = await dialog.showOpenDialog(ownerWindow(), { title: 'Select a destination folder', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const destinationToken = token();
      destinations.set(destinationToken, path.resolve(result.filePaths[0]));
      return { destinationToken, name: path.basename(result.filePaths[0]) || 'Selected folder' };
    },
    async selectFolder() {
      const result = await dialog.showOpenDialog(ownerWindow(), { title: 'Select a folder to enqueue', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const folderToken = token();
      folders.set(folderToken, path.resolve(result.filePaths[0]));
      return { folderToken, name: path.basename(result.filePaths[0]) || 'Selected folder' };
    },
    planBatch({ inputTokens, targetFormat, destinationToken }) {
      if (!Array.isArray(inputTokens) || !inputTokens.length || inputTokens.length > MAX_BATCH_ITEMS || new Set(inputTokens).size !== inputTokens.length) fail('INVALID_BATCH', `Choose between 1 and ${MAX_BATCH_ITEMS} unique inputs.`);
      const target = assertFormat(targetFormat, 'output format');
      const root = destinationFor(destinationToken);
      return inputTokens.map((inputToken) => {
        const input = inputFor(inputToken);
        const name = outputName(input.name, target);
        validateDestination(root, path.join(root, name));
        return { inputToken, inputName: input.name, outputName: name, supported: input.detected.supported && CONVERSIONS[input.detected.format].includes(target) };
      });
    },
    async runBatch({ inputTokens, targetFormat, destinationToken, confirmOverwrite = false }) {
      const plan = this.planBatch({ inputTokens, targetFormat, destinationToken });
      const root = destinationFor(destinationToken);
      const results = [];
      for (const item of plan) {
        try {
          if (!item.supported) fail('UNSUPPORTED_CONVERSION', 'That conversion is unsupported or would be lossy.');
          const converted = await convert(item.inputToken, targetFormat);
          const destination = await writeGuarded(root, path.join(root, item.outputName), converted.buffer, { overwrite: confirmOverwrite, io });
          results.push({ inputName: item.inputName, outputName: path.basename(destination), status: 'converted', bytes: converted.outputBytes });
        } catch (error) {
          const safe = publicError(error);
          results.push({ inputName: item.inputName, outputName: item.outputName, status: 'failed', error: safe });
        }
      }
      return { converted: results.filter((item) => item.status === 'converted').length, failed: results.filter((item) => item.status === 'failed').length, items: results };
    },
    async planPdf({ operation, inputTokens, destinationToken = null, options = {} }) {
      const selectedOperation = assertPdfOperation(operation);
      const selectedInputs = await pdfInputBuffers(inputTokens);
      if (selectedOperation !== 'inspect' && !destinationToken) fail('DESTINATION_REQUIRED', 'Choose a destination folder before planning a PDF mutation.');
      const root = selectedOperation === 'inspect' ? null : destinationFor(destinationToken);
      const result = await executePdfOperation({ operation: selectedOperation, inputs: selectedInputs, options });
      const summaries = selectedOperation === 'inspect'
        ? []
        : result.outputs.map((output) => {
          validateDestination(root, path.join(root, output.name));
          return { name: output.name, bytes: output.buffer.length };
        });
      const planToken = token();
      prunePdfPlans();
      pdfPlans.set(planToken, { operation: selectedOperation, inputTokens: [...inputTokens], destinationToken, options: structuredClone(options), createdAt: Date.now() });
      return selectedOperation === 'inspect'
        ? { planToken, operation: selectedOperation, inspection: result.inspection, inspections: result.inspections }
        : { planToken, operation: selectedOperation, outputs: summaries };
    },
    async executePdf({ planToken, confirmOverwrite = false }) {
      prunePdfPlans();
      if (typeof planToken !== 'string' || planToken.length > 64 || !pdfPlans.has(planToken)) fail('UNKNOWN_PDF_PLAN', 'Create the PDF operation plan again.');
      const plan = pdfPlans.get(planToken);
      if (Date.now() - plan.createdAt > PDF_PLAN_TTL_MS) { pdfPlans.delete(planToken); fail('EXPIRED_PDF_PLAN', 'The PDF plan expired. Review the operation again before running it.'); }
      pdfPlans.delete(planToken);
      const selectedInputs = await pdfInputBuffers(plan.inputTokens);
      const result = await executePdfOperation({ operation: plan.operation, inputs: selectedInputs, options: plan.options });
      if (plan.operation === 'inspect') return { operation: plan.operation, inspection: result.inspection, inspections: result.inspections };
      const root = destinationFor(plan.destinationToken);
      const written = [];
      for (const output of result.outputs) {
        const destination = await writePdfAtomic(root, path.join(root, output.name), output.buffer, { overwrite: confirmOverwrite, io });
        written.push({ name: path.basename(destination), bytes: output.buffer.length });
      }
      return { operation: plan.operation, outputs: written };
    },
    async enqueueBatch({ inputTokens, destinationToken, rule, groupRules = {} }) {
      if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.');
      if (!Array.isArray(inputTokens) || !inputTokens.length || new Set(inputTokens).size !== inputTokens.length) fail('INVALID_BATCH', 'Choose one or more unique inputs.');
      const paths = inputTokens.map((inputToken) => inputFor(inputToken).path);
      return queue.enqueue({ paths, destinationRoot: destinationFor(destinationToken), rule, groupRules });
    },
    async selectAndEnqueueFolder({ destinationToken, rule, groupRules = {}, recursive = true, extensions = [] }) {
      if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.');
      const result = await dialog.showOpenDialog(ownerWindow(), { title: 'Select a folder to enqueue', properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths?.[0]) return [];
      return queue.enqueueFolder({ folderPath: result.filePaths[0], destinationRoot: destinationFor(destinationToken), rule, groupRules, recursive, extensions });
    },
    async enqueueFolder({ folderToken, destinationToken, rule, groupRules = {}, recursive = true, extensions = [] }) {
      if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.');
      return queue.enqueueFolder({ folderPath: folderFor(folderToken), destinationRoot: destinationFor(destinationToken), rule, groupRules, recursive, extensions });
    },
    queueSnapshot() { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.snapshot(); },
    queuePreflight() { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.preflight(); },
    queueResume() { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.start(); },
    queuePause() { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.pause(); },
    queueCancel() { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.cancel(); },
    queueRetry({ jobIds = null } = {}) { if (!queue) fail('QUEUE_UNAVAILABLE', 'Persistent conversion queue storage is unavailable.'); return queue.retry({ jobIds }); }
  });
}

function publicError(error) {
  if (error instanceof ConverterError) return { code: error.code, message: error.message };
  return { code: 'CONVERSION_FAILED', message: 'The conversion could not be completed.' };
}

module.exports = {
  FORMATS, FORMAT_REGISTRY, PDF_OPERATIONS, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, MAX_BATCH_ITEMS, ConverterError,
  detectFormat, availableConversions, convertBuffer, previewConversion, validateDestination,
  writeGuarded, writePdfAtomic, readBounded, getFormatRegistry, getFlatFormatRegistry, inspectPdfBuffer, executePdfOperation, createPersistentConversionQueue, createConverterService, publicError
};
