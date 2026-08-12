'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn: nodeSpawn, execFile: nodeExecFile } = require('node:child_process');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const REGISTRY_ORIGIN = 'https://registry.ollama.ai';
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const LIMITS = Object.freeze({ json: 2 * MiB, stream: 16 * MiB, line: 128 * 1024, events: 65536, catalogPages: 256, repositories: 10000, tags: 250000 });

class OllamaError extends Error {
  constructor(code, message, recovery = null) {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
    this.recovery = recovery;
  }
}

function fail(code, message, recovery) { throw new OllamaError(code, message, recovery); }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exactRecord(value, keys, name = 'value') {
  if (!isRecord(value)) fail('INVALID_INPUT', `${name} must be an object.`);
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) fail('INVALID_INPUT', `${name} contains unsupported fields.`);
  return value;
}
function boundedText(value, name, maximum, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || (!multiline && /[\r\n]/.test(value)) || (!empty && !value.trim())) fail('INVALID_INPUT', `${name} is invalid.`);
  return value;
}
function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INVALID_INPUT', `${name} is invalid.`);
  return value;
}
function finiteNumber(value, name, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail('INVALID_INPUT', `${name} is invalid.`);
  return value;
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function normalizeEndpoint(value) {
  boundedText(value, 'Ollama endpoint', 2048);
  if (value !== value.trim() || value.includes('\\') || value.includes('?') || value.includes('#')) fail('ENDPOINT_REJECTED', 'The Ollama endpoint must be an exact loopback origin.', 'Use http://127.0.0.1:11434.');
  let parsed;
  try { parsed = new URL(value); } catch { fail('ENDPOINT_REJECTED', 'The Ollama endpoint is invalid.', 'Use http://127.0.0.1:11434.'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '11434' || parsed.username || parsed.password || parsed.search || parsed.hash || !['/', '/v1', '/v1/'].includes(parsed.pathname)) {
    fail('ENDPOINT_REJECTED', 'Only the exact local Ollama endpoint is allowed.', 'Use the in-app discovery action or http://127.0.0.1:11434.');
  }
  return parsed.origin;
}

function modelName(value) {
  const name = boundedText(value, 'Model name', 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(name) || name.includes('//') || name.split(/[/:]/).includes('..')) fail('INVALID_MODEL', 'The model name is invalid.');
  return name;
}

function publicError(error) {
  if (error instanceof OllamaError) return { code: error.code, message: error.message, recovery: error.recovery };
  if (error?.name === 'AbortError') return { code: 'CANCELLED', message: 'The Ollama operation was cancelled.', recovery: null };
  return { code: 'OLLAMA_FAILED', message: 'The Ollama operation could not be completed.', recovery: 'Check the in-app Ollama status and recovery guidance.' };
}

function linkSignals(caller, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: caller ? AbortSignal.any([caller, timeout]) : timeout, dispose: () => {} };
}

function abortError() { const error = new Error('cancelled'); error.name = 'AbortError'; return error; }
async function cancelBody(body, iterator) {
  try { if (typeof body?.destroy === 'function') body.destroy(abortError()); else if (typeof body?.cancel === 'function') await body.cancel(); else if (typeof iterator?.return === 'function') await iterator.return(); } catch {}
}
function nextWithAbort(iterator, signal, body) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const aborted = () => { if (!settled) { settled = true; void cancelBody(body, iterator); reject(abortError()); } };
    signal?.addEventListener('abort', aborted, { once: true });
    Promise.resolve(iterator.next()).then((value) => { signal?.removeEventListener('abort', aborted); if (!settled) { settled = true; resolve(value); } }, (error) => { signal?.removeEventListener('abort', aborted); if (!settled) { settled = true; reject(error); } });
  });
}

async function readBytes(response, maximum, signal) {
  const advertised = response.headers?.get?.('content-length');
  if (advertised != null && (!/^\d+$/.test(advertised) || Number(advertised) > maximum)) fail('RESPONSE_TOO_LARGE', 'The Ollama response exceeded the allowed size.');
  if (!response.body) return Buffer.alloc(0);
  const chunks = []; let size = 0; const iterator = response.body[Symbol.asyncIterator]();
  while (true) {
    const next = await nextWithAbort(iterator, signal, response.body); if (next.done) break; const chunk = next.value;
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > maximum) fail('RESPONSE_TOO_LARGE', 'The Ollama response exceeded the allowed size.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function readJson(response, maximum, signal) {
  const bytes = await readBytes(response, maximum, signal);
  if (!bytes.length) fail('MALFORMED_RESPONSE', 'Ollama returned an empty response.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('MALFORMED_RESPONSE', 'Ollama returned malformed JSON.'); }
}

async function readNdjson(response, { signal, onEvent, requireDone = true, maximum = LIMITS.stream }) {
  if (!response.body) fail('MALFORMED_STREAM', 'Ollama returned an empty stream.');
  let buffered = Buffer.alloc(0); let total = 0; let count = 0; let done = false; let last;
  const emit = (line) => {
    if (!line.length || !line.toString('utf8').trim()) return;
    if (line.length > LIMITS.line) fail('MALFORMED_STREAM', 'An Ollama stream record exceeded the allowed size.');
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { fail('MALFORMED_STREAM', 'Ollama returned malformed streaming data.'); }
    if (!isRecord(value)) fail('MALFORMED_STREAM', 'Ollama returned malformed streaming data.');
    count += 1; if (count > LIMITS.events) fail('MALFORMED_STREAM', 'Ollama returned too many streaming records.');
    if (typeof value.error === 'string') fail('OLLAMA_REJECTED', 'Ollama rejected the operation.');
    if (value.done === true) done = true;
    last = value; onEvent?.(value);
  };
  const iterator = response.body[Symbol.asyncIterator]();
  while (true) {
    const next = await nextWithAbort(iterator, signal, response.body); if (next.done) break; const chunk = next.value;
    const bytes = Buffer.from(chunk); total += bytes.length;
    if (total > maximum) fail('RESPONSE_TOO_LARGE', 'The Ollama stream exceeded the allowed size.');
    buffered = Buffer.concat([buffered, bytes]);
    let newline;
    while ((newline = buffered.indexOf(10)) >= 0) { const line = buffered.subarray(0, newline); buffered = buffered.subarray(newline + 1); emit(line.at(-1) === 13 ? line.subarray(0, -1) : line); }
    if (buffered.length > LIMITS.line) fail('MALFORMED_STREAM', 'An Ollama stream record exceeded the allowed size.');
  }
  if (buffered.length) emit(buffered);
  if (requireDone && !done) fail('INCOMPLETE_STREAM', 'The Ollama stream ended before completion.');
  return last;
}

function safeModelDetails(raw, inventory = null) {
  if (!isRecord(raw)) fail('MALFORMED_RESPONSE', 'Ollama returned invalid model details.');
  const details = isRecord(raw.details) ? raw.details : {};
  const info = isRecord(raw.model_info) ? raw.model_info : {};
  const contextEntry = Object.entries(info).find(([key, value]) => /context_length$/i.test(key) && Number.isSafeInteger(value));
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter((item) => typeof item === 'string').slice(0, 64).map((item) => item.slice(0, 128)) : [];
  return {
    name: inventory?.name || null,
    sizeBytes: Number.isSafeInteger(inventory?.size) && inventory.size >= 0 ? inventory.size : null,
    digest: typeof inventory?.digest === 'string' ? inventory.digest.slice(0, 256) : null,
    format: typeof details.format === 'string' ? details.format.slice(0, 128) : null,
    family: typeof details.family === 'string' ? details.family.slice(0, 128) : null,
    families: Array.isArray(details.families) ? details.families.filter((x) => typeof x === 'string').slice(0, 32) : [],
    parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size.slice(0, 64) : null,
    quantization: typeof details.quantization_level === 'string' ? details.quantization_level.slice(0, 64) : null,
    contextLength: contextEntry ? contextEntry[1] : null,
    capabilities,
    variants: Array.isArray(raw.tags) ? raw.tags.filter((x) => typeof x === 'string').slice(0, 10000) : []
  };
}

function validateMessages(messages, system) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 64) fail('INVALID_CHAT', 'Chat messages are invalid.');
  let total = 0; const normalized = [];
  if (system != null && system !== '') { const content = boundedText(system, 'System message', 32768, { multiline: true }); total += content.length; normalized.push({ role: 'system', content }); }
  for (const item of messages) {
    exactRecord(item, ['role', 'content'], 'Chat message');
    if (!['system', 'user', 'assistant'].includes(item.role)) fail('INVALID_CHAT', 'A chat message role is invalid.');
    const content = boundedText(item.content, 'Chat message', 65536, { multiline: true }); total += content.length;
    normalized.push({ role: item.role, content });
  }
  if (total > 256 * 1024) fail('INVALID_CHAT', 'The chat transcript is too large.');
  return normalized;
}

function validateChatOptions(value = {}) {
  exactRecord(value, ['temperature', 'top_p', 'top_k', 'num_ctx', 'seed', 'repeat_penalty'], 'Chat options');
  const result = {};
  if (value.temperature != null) result.temperature = finiteNumber(value.temperature, 'temperature', 0, 2);
  if (value.top_p != null) result.top_p = finiteNumber(value.top_p, 'top_p', 0, 1);
  if (value.top_k != null) result.top_k = boundedInteger(value.top_k, 'top_k', 0, 1000);
  if (value.num_ctx != null) result.num_ctx = boundedInteger(value.num_ctx, 'num_ctx', 128, 1048576);
  if (value.seed != null) result.seed = boundedInteger(value.seed, 'seed', -1, 2147483647);
  if (value.repeat_penalty != null) result.repeat_penalty = finiteNumber(value.repeat_penalty, 'repeat_penalty', 0, 4);
  return result;
}

function parseSize(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return null;
  const scale = { B: 1, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4 }[match[2].toUpperCase()];
  const bytes = Number(match[1]) * scale;
  return Number.isSafeInteger(bytes) ? bytes : Math.floor(bytes);
}

function evaluateModelFit(model, hardware) {
  const sizeBytes = parseSize(model?.sizeBytes ?? model?.size);
  const contextLength = Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? model.contextLength : null;
  const availableRam = Number.isSafeInteger(hardware?.availableRamBytes) ? hardware.availableRamBytes : null;
  const totalRam = Number.isSafeInteger(hardware?.totalRamBytes) ? hardware.totalRamBytes : null;
  const vram = Array.isArray(hardware?.gpus) ? hardware.gpus.reduce((sum, gpu) => sum + (Number.isSafeInteger(gpu.vramBytes) ? gpu.vramBytes : 0), 0) : 0;
  const freeDisk = Number.isSafeInteger(hardware?.freeDiskBytes) ? hardware.freeDiskBytes : null;
  if (sizeBytes == null) return { verdict: 'Unknown', code: 'MODEL_SIZE_UNKNOWN', reasons: ['The published tag size is unavailable.'], evidence: { sizeBytes: null, contextLength, availableRam, totalRam, vramBytes: vram || null, freeDisk } };
  const contextOverhead = contextLength == null ? null : Math.max(512 * MiB, contextLength * 256 * 1024);
  const requiredMemory = Math.ceil(sizeBytes * 1.2 + (contextOverhead ?? GiB));
  const requiredDisk = Math.ceil(sizeBytes * 1.15 + 512 * MiB);
  const reasons = [];
  if (freeDisk != null && freeDisk < requiredDisk) reasons.push('Free disk space is below the conservative download requirement.');
  if (totalRam != null && totalRam + vram < requiredMemory) reasons.push('Total RAM and reported VRAM are below the conservative runtime requirement.');
  let verdict = 'Unknown'; let code = 'HARDWARE_DATA_INCOMPLETE';
  if (reasons.length) { verdict = 'Unlikely'; code = 'INSUFFICIENT_RESOURCES'; }
  else if (availableRam != null && freeDisk != null) {
    const activeMemory = availableRam + vram;
    if (activeMemory >= requiredMemory * 1.5 && freeDisk >= requiredDisk * 2) { verdict = 'Runs well'; code = 'FIT_COMFORTABLE'; }
    else if (activeMemory >= requiredMemory && freeDisk >= requiredDisk) { verdict = 'Runs with limits'; code = 'FIT_TIGHT'; reasons.push('Resources meet conservative minimums but have limited headroom.'); }
    else { verdict = 'Unlikely'; code = 'INSUFFICIENT_AVAILABLE_RESOURCES'; reasons.push('Currently available RAM, VRAM, or disk is below the conservative requirement.'); }
  } else reasons.push('Available RAM or disk information is unavailable.');
  if (contextLength == null) reasons.push('Context length is unavailable; a conservative 1 GiB context overhead was used.');
  return { verdict, code, reasons, evidence: { sizeBytes, contextLength, requiredMemoryBytes: requiredMemory, requiredDiskBytes: requiredDisk, availableRamBytes: availableRam, totalRamBytes: totalRam, vramBytes: vram || null, freeDiskBytes: freeDisk } };
}

function powershellPath(environment = process.env) {
  const root = environment.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function execFileBounded(execFile, executable, args, maximum = MiB) {
  return new Promise((resolve, reject) => execFile(executable, args, { windowsHide: true, timeout: 10000, maxBuffer: maximum, shell: false }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

async function collectHardware({ statfs = fs.statfs, execFile = nodeExecFile, environment = process.env, platform = process.platform, arch = process.arch, totalmem = os.totalmem, freemem = os.freemem, diskPath = process.cwd() } = {}) {
  let freeDiskBytes = null; try { const stat = await statfs(diskPath); freeDiskBytes = Number(stat.bavail) * Number(stat.bsize); } catch {}
  const hardware = { platform, arch, totalRamBytes: totalmem(), availableRamBytes: freemem(), freeDiskBytes: Number.isSafeInteger(freeDiskBytes) ? freeDiskBytes : null, gpus: [], warnings: [] };
  if (platform === 'win32') {
    const script = "$g=Get-CimInstance Win32_VideoController|Select-Object Name,DriverVersion,AdapterRAM; $g|ConvertTo-Json -Compress";
    try {
      const output = await execFileBounded(execFile, powershellPath(environment), ['-NoProfile', '-NonInteractive', '-Command', script]);
      const parsed = JSON.parse(output || '[]');
      hardware.gpus = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord).slice(0, 16).map((gpu) => ({ name: typeof gpu.Name === 'string' ? gpu.Name.slice(0, 256) : 'Unknown GPU', driverVersion: typeof gpu.DriverVersion === 'string' ? gpu.DriverVersion.slice(0, 128) : null, vramBytes: Number.isSafeInteger(Number(gpu.AdapterRAM)) && Number(gpu.AdapterRAM) > 0 ? Number(gpu.AdapterRAM) : null }));
    } catch { hardware.warnings.push({ code: 'GPU_INVENTORY_UNAVAILABLE', recovery: 'Open the in-app hardware help for manual verification.' }); }
  }
  return hardware;
}

function nextRegistryUrl(response, current) {
  const raw = response.headers?.get?.('link');
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  if (!match) return null;
  const next = new URL(match[1], current);
  if (next.origin !== REGISTRY_ORIGIN || !/^\/v2\/(?:_catalog|library\/[A-Za-z0-9._/-]+\/tags\/list)$/.test(next.pathname) || next.username || next.password || next.hash) fail('CATALOG_REJECTED', 'The registry returned an unsafe pagination link.');
  return next.href;
}

async function readCache(io, cachePath) {
  if (!cachePath) return null;
  try { const parsed = JSON.parse(await io.readFile(cachePath, 'utf8')); return isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.models) ? parsed : null; } catch { return null; }
}
async function readJsonFile(io, file) {
  try { const parsed = JSON.parse(await io.readFile(file, 'utf8')); return isRecord(parsed) && parsed.version === 1 ? parsed : null; } catch { return null; }
}
async function writeJsonAtomic(io, file, value) {
  await io.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await io.writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
  await io.rename(temporary, file);
}

async function fetchOfficialCatalog({ fetcher = globalThis.fetch, io = fs, cachePath, signal, now = () => Date.now(), maximumAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const cached = await readCache(io, cachePath);
  const headers = { Accept: 'application/json' };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  const getPages = async (first, kind) => {
    const values = []; const seen = new Set(); let url = first; let pages = 0;
    while (url) {
      if (seen.has(url)) fail('CATALOG_REJECTED', 'The official catalog returned a pagination cycle.');
      seen.add(url);
      pages += 1; if (pages > LIMITS.catalogPages) fail('CATALOG_TOO_LARGE', 'The official catalog exceeded the pagination limit.');
      const response = await fetcher(url, { method: 'GET', headers: pages === 1 ? headers : { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal });
      if (response.status === 304 && cached && kind === 'repositories') return { notModified: true, values: [] };
      if (!response.ok || (response.status >= 300 && response.status < 400)) fail('CATALOG_UNAVAILABLE', `The official catalog returned HTTP ${response.status}.`);
      const data = await readJson(response, LIMITS.json, signal);
      const batch = data[kind]; if (!Array.isArray(batch) || batch.some((item) => typeof item !== 'string')) fail('MALFORMED_CATALOG', 'The official catalog returned malformed data.');
      values.push(...batch); url = nextRegistryUrl(response, url);
    }
    return { notModified: false, values };
  };
  try {
    const repositoriesResult = await getPages(`${REGISTRY_ORIGIN}/v2/_catalog?n=100`, 'repositories');
    if (repositoriesResult.notModified) return { ...cached, source: 'cache', stale: now() - cached.fetchedAt > maximumAgeMs };
    const repositories = repositoriesResult.values.filter((name) => name.startsWith('library/'));
    if (repositories.length > LIMITS.repositories) fail('CATALOG_TOO_LARGE', 'The official catalog contains too many repositories.');
    const models = []; let tagCount = 0;
    for (const repository of repositories) {
      if (!/^library\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(repository) || repository.includes('..')) fail('MALFORMED_CATALOG', 'The official catalog contains an invalid repository name.');
      const result = await getPages(`${REGISTRY_ORIGIN}/v2/${repository}/tags/list?n=100`, 'tags');
      tagCount += result.values.length; if (tagCount > LIMITS.tags) fail('CATALOG_TOO_LARGE', 'The official catalog contains too many tags.');
      models.push({ name: repository.slice('library/'.length), tags: [...result.values] });
    }
    const record = { version: 1, fetchedAt: now(), revision: crypto.createHash('sha256').update(JSON.stringify(models)).digest('hex'), etag: null, source: 'network', stale: false, models };
    if (cachePath) await writeJsonAtomic(io, cachePath, record);
    return record;
  } catch (error) {
    if (cached) return { ...cached, source: 'cache', stale: true, warning: publicError(error) };
    throw error;
  }
}

function defaultRuntimeProfiles(environment = process.env) {
  const local = environment.LOCALAPPDATA || '';
  const programFiles = environment.ProgramFiles || 'C:\\Program Files';
  return Object.freeze([
    { id: 'ollama-serve', label: 'Ollama local service', candidates: [path.join(local, 'Programs', 'Ollama', 'ollama.exe'), path.join(programFiles, 'Ollama', 'ollama.exe')].filter(Boolean), argsTemplate: ['serve'], placeholders: [], configMutations: [] },
    { id: 'ollama-model-smoke', label: 'Ollama model smoke test', candidates: [path.join(local, 'Programs', 'Ollama', 'ollama.exe'), path.join(programFiles, 'Ollama', 'ollama.exe')].filter(Boolean), argsTemplate: ['run', '{model}', 'Reply with OK.'], placeholders: ['model'], configMutations: [] }
  ]);
}

function validateProfile(profile, allowlistedExecutables, allowlistedConfigRoots = []) {
  exactRecord(profile, ['id', 'label', 'executable', 'argsTemplate', 'placeholders', 'configMutations'], 'Harness profile');
  const executable = path.resolve(boundedText(profile.executable, 'Harness executable', 2048));
  if (!path.isAbsolute(executable) || !allowlistedExecutables.map((item) => path.resolve(item).toLowerCase()).includes(executable.toLowerCase())) fail('PROFILE_EXECUTABLE_REJECTED', 'The harness executable is not allowlisted.');
  if (!Array.isArray(profile.argsTemplate) || profile.argsTemplate.length > 32) fail('INVALID_PROFILE', 'The harness argument template is invalid.');
  const placeholders = Array.isArray(profile.placeholders) ? profile.placeholders : [];
  const argsTemplate = profile.argsTemplate.map((arg) => {
    boundedText(arg, 'Harness argument', 1024);
    const matches = [...arg.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]);
    if (matches.some((name) => !placeholders.includes(name)) || arg.replace(/\{[a-z]+\}/g, '').includes('{')) fail('INVALID_PROFILE', 'The harness argument template contains an unsupported placeholder.');
    return arg;
  });
  const configMutations = (Array.isArray(profile.configMutations) ? profile.configMutations : []).map((mutation) => {
    exactRecord(mutation, ['path', 'content'], 'Config mutation');
    const target = path.resolve(boundedText(mutation.path, 'Config path', 2048));
    if (!allowlistedConfigRoots.some((root) => { const relative = path.relative(path.resolve(root), target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); })) fail('PROFILE_CONFIG_REJECTED', 'The harness configuration path is not allowlisted.');
    if (!isRecord(mutation.content) || JSON.stringify(mutation.content).length > MiB) fail('INVALID_PROFILE', 'The harness configuration content is invalid.');
    return { path: target, content: mutation.content };
  });
  return { id: boundedText(profile.id, 'Profile id', 64), label: boundedText(profile.label, 'Profile label', 128), executable, argsTemplate, placeholders, configMutations };
}

async function pathExists(io, target) { try { const stat = await io.stat(target); return stat.isFile(); } catch { return false; } }
function renderArgs(profile, values = {}) {
  exactRecord(values, profile.placeholders, 'Harness values');
  return profile.argsTemplate.map((arg) => arg.replace(/\{([a-z]+)\}/g, (_, key) => key === 'model' ? modelName(values[key]) : boundedText(values[key], key, 2048)));
}

async function snapshotConfigs(io, profile, root) {
  const id = crypto.randomUUID(); const folder = path.join(root, id); const files = [];
  await io.mkdir(folder, { recursive: true });
  for (const mutation of profile.configMutations) {
    exactRecord(mutation, ['path', 'content'], 'Config mutation');
    const target = path.resolve(boundedText(mutation.path, 'Config path', 2048));
    const backup = path.join(folder, `${files.length}.bak`); let existed = false;
    try { const bytes = await io.readFile(target); if (bytes.length > MiB) fail('CONFIG_TOO_LARGE', 'A harness configuration file is too large to snapshot.'); await io.writeFile(`${backup}.tmp`, bytes, { flag: 'wx' }); await io.rename(`${backup}.tmp`, backup); existed = true; } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
    files.push({ target, backup, existed });
  }
  await writeJsonAtomic(io, path.join(folder, 'manifest.json'), { version: 1, profileId: profile.id, profileName: profile.label, createdAt: new Date().toISOString(), files });
  return { snapshotId: id, folder, files };
}

async function restoreSnapshot(io, snapshotsRoot, snapshotId) {
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) fail('INVALID_SNAPSHOT', 'The snapshot identifier is invalid.');
  const folder = path.join(snapshotsRoot, snapshotId); const manifest = JSON.parse(await io.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  for (const entry of manifest.files) {
    if (entry.existed) { const temporary = `${entry.target}.${crypto.randomUUID()}.restore`; await io.mkdir(path.dirname(entry.target), { recursive: true }); await io.copyFile(entry.backup, temporary); await io.rename(temporary, entry.target); }
    else { try { await io.unlink(entry.target); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  return { restored: true, snapshotId };
}

async function listSnapshots(io, snapshotsRoot) {
  let entries;
  try { entries = await io.readdir(snapshotsRoot, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const snapshots = [];
  for (const entry of entries.slice(0, 10000)) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const manifest = await readJsonFile(io, path.join(snapshotsRoot, entry.name, 'manifest.json'));
    if (!manifest || typeof manifest.profileId !== 'string' || !Array.isArray(manifest.files)) continue;
    snapshots.push({
      id: entry.name,
      snapshotId: entry.name,
      profileId: manifest.profileId.slice(0, 64),
      profileName: typeof manifest.profileName === 'string' ? manifest.profileName.slice(0, 128) : manifest.profileId.slice(0, 64),
      createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt.slice(0, 64) : null,
      status: 'ready',
      restorable: true,
      changes: manifest.files.map((item) => path.basename(typeof item?.target === 'string' ? item.target : '')).filter(Boolean).slice(0, 128)
    });
  }
  return snapshots.sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
}

function launchProcess(spawn, executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, detached: false, stdio: 'ignore' });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ pid: child.pid ?? null }); } }, 750);
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.once('exit', (code) => { if (!settled && code !== 0) { settled = true; clearTimeout(timer); reject(new OllamaError('HARNESS_LAUNCH_FAILED', `The harness exited with code ${code}.`, 'Review the in-app harness preflight details.')); } });
  });
}

function createOllamaManager(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const io = options.io || fs;
  const spawn = options.spawn || nodeSpawn;
  const endpoint = normalizeEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const dataRoot = options.dataRoot || path.join(os.tmpdir(), 'material-encryption-ollama');
  const cachePath = path.join(dataRoot, 'catalog-cache.v1.json');
  const historyPath = path.join(dataRoot, 'chat-history.v1.json');
  const snapshotsRoot = path.join(dataRoot, 'harness-snapshots');
  const active = new Map();

  async function request(route, { method = 'GET', body, signal, timeoutMs = 30000, stream = false, onEvent } = {}) {
    if (!['/api/version', '/api/tags', '/api/show', '/api/pull', '/api/delete', '/api/chat'].includes(route)) fail('OPERATION_REJECTED', 'That Ollama operation is not allowlisted.');
    const context = linkSignals(signal, timeoutMs);
    try {
      const response = await fetcher(`${endpoint}${route}`, { method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: context.signal });
      if (response.status >= 300 && response.status < 400) fail('REDIRECT_REJECTED', 'Ollama redirects are not allowed.');
      if (!response.ok) fail('OLLAMA_HTTP_ERROR', `Ollama returned HTTP ${response.status}.`, 'Check whether the local Ollama service and selected model are ready.');
      return stream ? readNdjson(response, { signal: context.signal, onEvent }) : readJson(response, LIMITS.json, context.signal);
    } catch (error) {
      if (signal?.aborted || context.signal.aborted && error?.code !== 'OLLAMA_HTTP_ERROR') { const cancelled = new Error('cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
      throw error;
    } finally { context.dispose(); }
  }

  const begin = (kind, task) => {
    const operationId = crypto.randomUUID(); const controller = new AbortController(); active.set(operationId, { kind, controller });
    const promise = Promise.resolve().then(() => task(controller.signal, operationId)).finally(() => active.delete(operationId));
    return { operationId, promise };
  };

  async function discoveredProfiles(userProfiles = []) {
    const defaults = defaultRuntimeProfiles(options.environment);
    const found = [];
    for (const profile of defaults) {
      const executable = await (async () => { for (const candidate of profile.candidates) if (await pathExists(io, candidate)) return path.resolve(candidate); return null; })();
      const requiresValues = profile.placeholders.length > 0;
      found.push({ ...profile, name: profile.label, description: 'Built-in reviewed local Ollama runtime profile.', executable, installed: Boolean(executable), ready: Boolean(executable) && !requiresValues, available: Boolean(executable) && !requiresValues, code: !executable ? 'RUNTIME_NOT_INSTALLED' : (requiresValues ? 'PROFILE_VALUES_REQUIRED' : 'READY'), reason: !executable ? 'Ollama was not found in an allowlisted installation location.' : (requiresValues ? `Choose the required ${profile.placeholders.join(', ')} value before launch.` : null), recovery: !executable ? 'Install Ollama using the bundled in-app setup guidance.' : (requiresValues ? 'Choose an installed model in the reviewed harness launch form.' : null), requiredValues: [...profile.placeholders] });
    }
    const allowed = defaults.flatMap((item) => item.candidates);
    const configRoots = [path.join(options.environment?.LOCALAPPDATA || process.env.LOCALAPPDATA || '', 'Ollama')].filter((item) => path.isAbsolute(item));
    for (const profile of userProfiles) { const validated = validateProfile(profile, allowed, configRoots); const installed = await pathExists(io, validated.executable); found.push({ ...validated, name: validated.label, description: 'Validated user profile using an allowlisted installed runtime.', installed, ready: installed, available: installed, code: 'VALIDATED_USER_PROFILE', recovery: installed ? null : 'Restore the allowlisted Ollama installation, then refresh profiles.' }); }
    return found;
  }

  const pull = (name, onProgress) => begin('pull', async (signal) => request('/api/pull', { method: 'POST', body: { model: modelName(name), stream: true }, signal, timeoutMs: 6 * 60 * 60 * 1000, stream: true, onEvent: (event) => onProgress?.({ status: typeof event.status === 'string' ? event.status.slice(0, 256) : null, digest: typeof event.digest === 'string' ? event.digest.slice(0, 256) : null, total: Number.isSafeInteger(event.total) ? event.total : null, completed: Number.isSafeInteger(event.completed) ? event.completed : null, done: event.done === true }) }));

  const profilePreflight = async (profileId, values = {}, userProfiles = []) => {
    const profiles = await discoveredProfiles(userProfiles); const profile = profiles.find((item) => item.id === profileId);
    if (!profile) fail('PROFILE_NOT_FOUND', 'The harness profile is not available.');
    const missingValues = profile.placeholders.filter((key) => typeof values?.[key] !== 'string' || !values[key].trim());
    const args = profile.executable && !missingValues.length ? renderArgs(profile, values) : [];
    return { profileId, ready: profile.installed && !missingValues.length, executable: profile.executable, args, missingValues, code: !profile.installed ? 'RUNTIME_NOT_INSTALLED' : (missingValues.length ? 'PROFILE_VALUES_REQUIRED' : 'READY'), recovery: !profile.installed ? profile.recovery : (missingValues.length ? `Choose the required ${missingValues.join(', ')} value before launch.` : null) };
  };

  return Object.freeze({
    endpoint,
    guidance: () => ({ source: 'bundled-offline', recommendedEndpoint: DEFAULT_ENDPOINT, defaults: { pullConcurrency: 2, requestTimeoutMs: 30000, chatContext: 4096 }, install: { automaticInstallerAvailable: false, code: 'INSTALLER_NOT_BUNDLED', recovery: 'Use the bundled Help > Ollama setup steps; the app never guesses a download or opens an arbitrary command.' }, helpTopic: 'ollama-setup' }),
    discover: async () => { const profiles = await discoveredProfiles(); const service = await request('/api/version').then((value) => ({ reachable: true, version: typeof value.version === 'string' ? value.version.slice(0, 128) : null, code: 'READY' }), (error) => ({ reachable: false, version: null, code: publicError(error).code, recovery: 'Start the detected Ollama local service, then retry.' })); return { endpoint, service, runtimes: profiles.map(({ configMutations, argsTemplate, placeholders, candidates, ...profile }) => profile), guidance: { code: service.reachable ? 'READY' : 'SERVICE_UNAVAILABLE', helpTopic: 'ollama-setup' } }; },
    health: async () => { const value = await request('/api/version'); return { endpoint, healthy: true, version: typeof value.version === 'string' ? value.version.slice(0, 128) : null }; },
    list: async () => { const value = await request('/api/tags'); if (!Array.isArray(value.models)) fail('MALFORMED_RESPONSE', 'Ollama returned an invalid model inventory.'); return value.models.slice(0, 10000).filter(isRecord).map((model) => ({ name: modelName(model.name || model.model), size: Number.isSafeInteger(model.size) && model.size >= 0 ? model.size : null, digest: typeof model.digest === 'string' ? model.digest.slice(0, 256) : null, modifiedAt: typeof model.modified_at === 'string' ? model.modified_at.slice(0, 128) : null, details: isRecord(model.details) ? safeModelDetails({ details: model.details }, model) : null })); },
    show: async (name) => { const normalized = modelName(name); const inventory = (await request('/api/tags')).models?.find((item) => item.name === normalized || item.model === normalized); return safeModelDetails(await request('/api/show', { method: 'POST', body: { model: normalized } }), inventory); },
    pull,
    cancel: (operationIdOrKind) => { const key = boundedText(operationIdOrKind, 'Operation id or kind', 64); const entries = active.has(key) ? [[key, active.get(key)]] : [...active.entries()].filter(([, operation]) => operation.kind === key); if (!entries.length) return { cancelled: false, code: 'OPERATION_NOT_ACTIVE' }; for (const [, operation] of entries) operation.controller.abort(); return { cancelled: true, operationId: entries[0][0], operationIds: entries.map(([operationId]) => operationId), code: 'CANCEL_REQUESTED' }; },
    delete: async (name, confirmed) => { if (confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Deleting a model requires explicit confirmation.'); const normalized = modelName(name); await request('/api/delete', { method: 'DELETE', body: { model: normalized } }); return { deleted: true, model: normalized }; },
    pullBatch: async (items, { concurrency = 2, onProgress } = {}) => {
      if (!Array.isArray(items) || !items.length || items.length > 128) fail('INVALID_BATCH', 'The model cart is invalid.'); boundedInteger(concurrency, 'Pull concurrency', 1, 3);
      const models = items.map((item) => { exactRecord(item, ['name', 'sizeBytes'], 'Cart item'); return { name: modelName(item.name), sizeBytes: item.sizeBytes == null ? null : boundedInteger(item.sizeBytes, 'Model size', 0, Number.MAX_SAFE_INTEGER) }; });
      const unknownSize = models.filter((item) => item.sizeBytes == null);
      if (unknownSize.length) return { code: 'MODEL_SIZE_UNKNOWN', requiredDiskBytes: null, freeDiskBytes: null, outcomes: models.map((item) => ({ model: item.name, status: 'skipped', code: item.sizeBytes == null ? 'MODEL_SIZE_UNKNOWN' : 'BATCH_PREFLIGHT_BLOCKED' })) };
      const hardware = await collectHardware(options.hardware || {}); const knownDownload = models.reduce((sum, item) => sum + Math.ceil(item.sizeBytes * 1.15 + 512 * MiB), 0);
      if (hardware.freeDiskBytes == null) return { code: 'DISK_PREFLIGHT_UNAVAILABLE', requiredDiskBytes: knownDownload, freeDiskBytes: null, outcomes: models.map((item) => ({ model: item.name, status: 'skipped', code: 'DISK_PREFLIGHT_UNAVAILABLE' })) };
      if (hardware.freeDiskBytes < knownDownload) return { code: 'INSUFFICIENT_DISK', requiredDiskBytes: knownDownload, freeDiskBytes: hardware.freeDiskBytes, outcomes: models.map((item) => ({ model: item.name, status: 'skipped', code: 'INSUFFICIENT_DISK' })) };
      const outcomes = new Array(models.length); let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, async () => { while (cursor < models.length) { const index = cursor++; const item = models[index]; const operation = pull(item.name, (progress) => onProgress?.({ model: item.name, ...progress })); try { await operation.promise; outcomes[index] = { model: item.name, status: 'pulled', code: 'PULLED' }; } catch (error) { outcomes[index] = { model: item.name, status: error?.name === 'AbortError' ? 'cancelled' : 'failed', ...publicError(error) }; } } }));
      return { code: outcomes.every((item) => item.status === 'pulled') ? 'COMPLETE' : 'PARTIAL', requiredDiskBytes: knownDownload, freeDiskBytes: hardware.freeDiskBytes, outcomes };
    },
    chat: ({ model, system = '', messages, options: chatOptions = {} }) => begin('chat', async (signal) => { const value = await request('/api/chat', { method: 'POST', body: { model: modelName(model), messages: validateMessages(messages, system), options: validateChatOptions(chatOptions), stream: false }, signal, timeoutMs: 30 * 60 * 1000 }); const content = value?.message?.content; if (typeof content !== 'string' || content.length > MiB) fail('MALFORMED_RESPONSE', 'Ollama returned an invalid chat response.'); return { content, delivery: 'complete', progress: 'indeterminate-bounded' }; }),
    catalog: (catalogOptions = {}) => fetchOfficialCatalog({ fetcher, io, cachePath, ...catalogOptions }),
    catalogStore: async (catalogOptions = {}) => {
      const [catalog, installed, hardware] = await Promise.all([fetchOfficialCatalog({ fetcher, io, cachePath, ...catalogOptions }), request('/api/tags').then((value) => Array.isArray(value.models) ? value.models : [], () => []), collectHardware(options.hardware || {})]);
      const installedNames = new Set(installed.map((item) => item.name || item.model).filter((item) => typeof item === 'string'));
      const models = catalog.models.map((entry) => ({ ...entry, variants: entry.tags.map((tag) => { const full = `${entry.name}:${tag}`; const installedItem = installed.find((item) => (item.name || item.model) === full); const installedHere = installedNames.has(full); const sizeBytes = Number.isSafeInteger(installedItem?.size) ? installedItem.size : null; const downloadable = installedHere || sizeBytes != null; const fit = evaluateModelFit({ sizeBytes }, hardware); return { tag, name: entry.name, model: entry.name, installed: installedHere, available: downloadable, downloadable, unavailableReason: downloadable ? null : 'Published model bytes are unknown, so storage preflight cannot authorize this download.', sizeBytes, fitVerdict: fit.verdict, fitEvidence: fit.evidence, fitCaveat: fit.reasons.join(' ') || 'Conservative hardware thresholds were satisfied.' }; }) }));
      return { ...catalog, refreshedAt: new Date(catalog.fetchedAt).toISOString(), models };
    },
    hardware: () => collectHardware(options.hardware || {}),
    evaluateFit: (model, hardware) => evaluateModelFit(model, hardware),
    profiles: async (userProfiles = []) => ({ profiles: await discoveredProfiles(userProfiles), snapshots: await listSnapshots(io, snapshotsRoot) }),
    profilePreflight,
    profilePreview: async (profileId, values = {}, userProfiles = []) => { const result = await profilePreflight(profileId, values, userProfiles); return { ...result, shell: false, windowsHide: true, configFiles: [] }; },
    profileLaunch: async (profileId, values = {}, userProfiles = []) => { const profiles = await discoveredProfiles(userProfiles); const profile = profiles.find((item) => item.id === profileId); if (!profile || !profile.installed) fail('PROFILE_NOT_READY', 'The harness profile is not ready.', profile?.recovery || 'Use the in-app runtime discovery action.'); const preflight = await profilePreflight(profileId, values, userProfiles); if (!preflight.ready) fail('PROFILE_VALUES_REQUIRED', 'The harness profile requires reviewed values before launch.', preflight.recovery); const args = preflight.args; const snapshot = await snapshotConfigs(io, profile, snapshotsRoot); try { for (const mutation of profile.configMutations) { await writeJsonAtomic(io, path.resolve(mutation.path), mutation.content); } const launched = await launchProcess(spawn, profile.executable, args); return { launched: true, profileId, snapshotId: snapshot.snapshotId, snapshot: { id: snapshot.snapshotId, snapshotId: snapshot.snapshotId, profileName: profile.label, status: 'ready', restorable: true, changes: profile.configMutations.map((item) => path.basename(item.path)) }, pid: launched.pid }; } catch (error) { await restoreSnapshot(io, snapshotsRoot, snapshot.snapshotId); throw error; } },
    profileRestore: (snapshotId) => restoreSnapshot(io, snapshotsRoot, snapshotId),
    historyList: async () => { const cache = await readJsonFile(io, historyPath); return Array.isArray(cache?.records) ? cache.records : []; },
    historyUpsert: async (value) => { exactRecord(value, ['id', 'title', 'model', 'messageCount', 'createdAt', 'updatedAt'], 'Chat history metadata'); const existing = await readJsonFile(io, historyPath); const records = Array.isArray(existing?.records) ? existing.records : []; const record = { id: boundedText(value.id, 'History id', 64), title: boundedText(value.title, 'History title', 256), model: modelName(value.model), messageCount: boundedInteger(value.messageCount, 'Message count', 0, 1000000), createdAt: boundedText(value.createdAt, 'Created time', 64), updatedAt: boundedText(value.updatedAt, 'Updated time', 64) }; const next = records.filter((item) => item.id !== record.id); next.push(record); await writeJsonAtomic(io, historyPath, { version: 1, records: next.slice(-10000) }); return record; },
    historyDelete: async (id) => { const key = boundedText(id, 'History id', 64); const existing = await readJsonFile(io, historyPath); const prior = Array.isArray(existing?.records) ? existing.records : []; const records = prior.filter((item) => item.id !== key); await writeJsonAtomic(io, historyPath, { version: 1, records }); return { deleted: records.length !== prior.length }; }
  });
}

module.exports = { DEFAULT_ENDPOINT, LIMITS, OllamaError, normalizeEndpoint, modelName, publicError, readNdjson, safeModelDetails, evaluateModelFit, collectHardware, fetchOfficialCatalog, defaultRuntimeProfiles, validateProfile, restoreSnapshot, createOllamaManager };
