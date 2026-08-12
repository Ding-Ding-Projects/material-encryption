import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DEFAULT_ENDPOINT, normalizeEndpoint, publicError, evaluateModelFit, fetchOfficialCatalog, createOllamaManager } = require('../src/main/ollama-manager.cjs');
const GiB = 1024 ** 3;

function response(body, { status = 200, headers = {} } = {}) {
  const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-length': String(bytes.length), ...headers }), body: Readable.from([bytes]) };
}

function ndjson(lines, { chunks } = {}) {
  const bytes = Buffer.from(lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
  const parts = chunks ? chunks.map(([start, end]) => bytes.subarray(start, end)) : [bytes];
  return { ok: true, status: 200, headers: new Headers(), body: Readable.from(parts) };
}

test('only the exact default loopback Ollama endpoint is accepted', () => {
  assert.equal(normalizeEndpoint(DEFAULT_ENDPOINT), DEFAULT_ENDPOINT);
  assert.equal(normalizeEndpoint(`${DEFAULT_ENDPOINT}/v1`), DEFAULT_ENDPOINT);
  for (const endpoint of ['http://localhost:11434', 'http://127.0.0.2:11434', 'http://127.0.0.1:11435', 'https://127.0.0.1:11434', 'http://[::1]:11434', 'http://user:pass@127.0.0.1:11434', 'http://127.0.0.1:11434/api', 'http://127.0.0.1:11434?token=x', 'https://example.com']) {
    assert.throws(() => normalizeEndpoint(endpoint), (error) => error.code === 'ENDPOINT_REJECTED');
  }
});

test('health, tags, and detailed model metadata use fixed local routes', async () => {
  const calls = [];
  const manager = createOllamaManager({ fetcher: async (url, init) => {
    calls.push([url, init.method, init.redirect]);
    if (url.endsWith('/api/version')) return response({ version: '0.9.0' });
    if (url.endsWith('/api/tags')) return response({ models: [{ name: 'gemma3:4b', size: 3 * GiB, digest: 'sha256:x', modified_at: '2026-01-01', details: { format: 'gguf', family: 'gemma3', parameter_size: '4B', quantization_level: 'Q4_K_M' } }] });
    if (url.endsWith('/api/show')) return response({ details: { format: 'gguf', family: 'gemma3', parameter_size: '4B', quantization_level: 'Q4_K_M' }, model_info: { 'gemma3.context_length': 131072 }, capabilities: ['completion', 'vision'], tags: ['4b', '12b'] });
    throw new Error('unexpected route');
  }});
  assert.equal((await manager.health()).version, '0.9.0');
  assert.equal((await manager.list())[0].details.quantization, 'Q4_K_M');
  assert.deepEqual(await manager.show('gemma3:4b'), { name: 'gemma3:4b', sizeBytes: 3 * GiB, digest: 'sha256:x', format: 'gguf', family: 'gemma3', families: [], parameterSize: '4B', quantization: 'Q4_K_M', contextLength: 131072, capabilities: ['completion', 'vision'], variants: ['4b', '12b'] });
  assert.ok(calls.every(([url, , redirect]) => url.startsWith(`${DEFAULT_ENDPOINT}/api/`) && redirect === 'error'));
});

test('redirects and malformed or incomplete pull streams fail closed', async () => {
  const redirectManager = createOllamaManager({ fetcher: async () => response('', { status: 302, headers: { location: 'http://evil.invalid' } }) });
  await assert.rejects(redirectManager.health(), (error) => error.code === 'REDIRECT_REJECTED');
  const malformedManager = createOllamaManager({ fetcher: async () => ndjson(['{"status":', '{"done":true}']) });
  await assert.rejects(malformedManager.pull('gemma3:4b').promise, (error) => error.code === 'MALFORMED_STREAM');
  const incompleteManager = createOllamaManager({ fetcher: async () => ndjson([{ status: 'pulling', completed: 1, total: 2 }]) });
  await assert.rejects(incompleteManager.pull('gemma3:4b').promise, (error) => error.code === 'INCOMPLETE_STREAM');
});

test('pull progress streams across fragmented UTF-8 and chat uses a bounded complete response', async () => {
  const manager = createOllamaManager({ fetcher: async (url, init) => {
    if (url.endsWith('/api/pull')) return ndjson([{ status: '下載中', completed: 1, total: 2 }, { status: 'success', completed: 2, total: 2, done: true }], { chunks: [[0, 2], [2, 11], [11, 999]] });
    if (url.endsWith('/api/chat')) return response({ message: { content: 'hello' }, done: true });
    throw new Error('unexpected');
  }});
  const progress = [];
  const pull = manager.pull('gemma3:4b', (event) => progress.push(event));
  await pull.promise;
  assert.equal(progress.at(-1).done, true);
  const chat = manager.chat({ model: 'gemma3:4b', system: 'Be concise.', messages: [{ role: 'user', content: 'Hi' }], options: { temperature: 0.2, num_ctx: 4096 } });
  assert.deepEqual(await chat.promise, { content: 'hello', delivery: 'complete', progress: 'indeterminate-bounded' });
});

test('chat cancellation accepts an operation identifier or the active operation kind', async () => {
  const signals = [];
  const manager = createOllamaManager({ fetcher: async (_url, init) => {
    signals.push(init.signal);
    return { ok: true, status: 200, headers: new Headers(), body: Readable.from((async function* () { await new Promise((resolve) => init.signal.addEventListener('abort', resolve, { once: true })); })()) };
  }});
  const byId = manager.chat({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'Hi' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.cancel(byId.operationId).code, 'CANCEL_REQUESTED');
  await assert.rejects(byId.promise, (error) => error.name === 'AbortError');
  assert.equal(signals[0].aborted, true);
  const byKind = manager.chat({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'Again' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.cancel('chat').code, 'CANCEL_REQUESTED');
  await assert.rejects(byKind.promise, (error) => error.name === 'AbortError');
  assert.equal(signals[1].aborted, true);
});

test('bounded cart pulls preserve per-model partial outcomes and disk preflight', async () => {
  const manager = createOllamaManager({
    fetcher: async (_url, init) => {
      const model = JSON.parse(init.body).model;
      if (model === 'bad:latest') return response({ error: 'nope' }, { status: 500 });
      return ndjson([{ status: 'success', done: true }]);
    },
    hardware: { platform: 'linux', totalmem: () => 16 * GiB, freemem: () => 12 * GiB, statfs: async () => ({ bavail: 100 * GiB, bsize: 1 }) }
  });
  const partial = await manager.pullBatch([{ name: 'good:latest', sizeBytes: GiB }, { name: 'bad:latest', sizeBytes: GiB }], { concurrency: 2 });
  assert.equal(partial.code, 'PARTIAL');
  assert.deepEqual(partial.outcomes.map((item) => item.status).sort(), ['failed', 'pulled']);

  const lowDisk = createOllamaManager({ fetcher: async () => assert.fail('disk preflight must block network'), hardware: { platform: 'linux', totalmem: () => 16 * GiB, freemem: () => 12 * GiB, statfs: async () => ({ bavail: GiB, bsize: 1 }) } });
  const result = await lowDisk.pullBatch([{ name: 'large:latest', sizeBytes: 4 * GiB }]);
  assert.equal(result.code, 'INSUFFICIENT_DISK');
  assert.equal(result.outcomes[0].status, 'skipped');

  const unknownSize = createOllamaManager({ fetcher: async () => assert.fail('unknown size must block network'), hardware: { platform: 'linux', totalmem: () => 16 * GiB, freemem: () => 12 * GiB, statfs: async () => ({ bavail: 100 * GiB, bsize: 1 }) } });
  assert.equal((await unknownSize.pullBatch([{ name: 'unknown:latest', sizeBytes: null }])).code, 'MODEL_SIZE_UNKNOWN');

  const unknownDisk = createOllamaManager({ fetcher: async () => assert.fail('missing disk evidence must block network'), hardware: { platform: 'linux', totalmem: () => 16 * GiB, freemem: () => 12 * GiB, statfs: async () => { throw new Error('unavailable'); } } });
  assert.equal((await unknownDisk.pullBatch([{ name: 'known:latest', sizeBytes: GiB }])).code, 'DISK_PREFLIGHT_UNAVAILABLE');
});

test('official catalog follows bounded same-origin pagination and preserves every tag', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init.redirect]);
    if (url.includes('_catalog') && !url.includes('last=second')) return response({ repositories: ['library/gemma3'] }, { headers: { link: `<${url}&last=second>; rel="next"` } });
    if (url.includes('_catalog')) return response({ repositories: ['library/qwen3'] });
    if (url.includes('gemma3/tags')) return response({ name: 'library/gemma3', tags: ['1b', '4b', '12b', '27b'] });
    if (url.includes('qwen3/tags')) return response({ name: 'library/qwen3', tags: ['0.6b', '1.7b', '4b', '8b', '14b', '30b', '32b', '235b'] });
    throw new Error(url);
  };
  const catalog = await fetchOfficialCatalog({ fetcher });
  assert.deepEqual(catalog.models.map((model) => [model.name, model.tags.length]), [['gemma3', 4], ['qwen3', 8]]);
  assert.ok(calls.every(([url, redirect]) => url.startsWith('https://registry.ollama.ai/v2/') && redirect === 'error'));
});

test('official catalog refuses unsafe pagination and serves stale validated cache offline', async () => {
  await assert.rejects(fetchOfficialCatalog({ fetcher: async () => response({ repositories: [] }, { headers: { link: '<https://evil.invalid/v2/_catalog>; rel="next"' } }) }), (error) => error.code === 'CATALOG_REJECTED');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-cache-test-'));
  const cachePath = path.join(root, 'cache.json');
  const cached = { version: 1, fetchedAt: 1, revision: 'abc', etag: 'etag', source: 'network', stale: false, models: [{ name: 'gemma3', tags: ['4b', '12b'] }] };
  await fs.writeFile(cachePath, JSON.stringify(cached));
  try {
    const result = await fetchOfficialCatalog({ cachePath, fetcher: async () => { throw new Error('offline'); }, now: () => 999999999 });
    assert.equal(result.source, 'cache');
    assert.equal(result.stale, true);
    assert.deepEqual(result.models[0].tags, ['4b', '12b']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('catalog store maps installed variants and blocks unknown-size uninstalled variants', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-store-test-'));
  const cachePath = path.join(root, 'catalog-cache.v1.json');
  await fs.writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt: Date.now(), revision: 'catalog-revision', etag: null, source: 'network', stale: false, models: [{ name: 'gemma3', tags: ['4b', '12b'] }] }));
  const manager = createOllamaManager({ dataRoot: root, fetcher: async (url) => {
    if (url.endsWith('/api/tags')) return response({ models: [{ name: 'gemma3:4b', size: 3 * GiB }] });
    throw new Error('offline registry');
  }, hardware: { platform: 'linux', totalmem: () => 16 * GiB, freemem: () => 12 * GiB, statfs: async () => ({ bavail: 100 * GiB, bsize: 1 }) } });
  try {
    const store = await manager.catalogStore();
    const [installed, unknown] = store.models[0].variants;
    assert.equal(installed.installed, true);
    assert.equal(installed.available, true);
    assert.equal(installed.sizeBytes, 3 * GiB);
    assert.equal(unknown.installed, false);
    assert.equal(unknown.available, false);
    assert.equal(unknown.downloadable, false);
    assert.match(unknown.unavailableReason, /storage preflight cannot authorize/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('fit evaluator uses conservative RAM, VRAM, disk, and unknown verdicts', () => {
  const well = evaluateModelFit({ sizeBytes: 2 * GiB, contextLength: 4096 }, { totalRamBytes: 32 * GiB, availableRamBytes: 24 * GiB, freeDiskBytes: 100 * GiB, gpus: [{ vramBytes: 8 * GiB }] });
  assert.equal(well.verdict, 'Runs well');
  const limited = evaluateModelFit({ sizeBytes: 4 * GiB, contextLength: 4096 }, { totalRamBytes: 16 * GiB, availableRamBytes: 6 * GiB, freeDiskBytes: 7 * GiB, gpus: [] });
  assert.equal(limited.verdict, 'Runs with limits');
  const unlikely = evaluateModelFit({ sizeBytes: 10 * GiB, contextLength: 131072 }, { totalRamBytes: 8 * GiB, availableRamBytes: 4 * GiB, freeDiskBytes: 9 * GiB, gpus: [] });
  assert.equal(unlikely.verdict, 'Unlikely');
  assert.equal(evaluateModelFit({ sizeBytes: null }, {}).verdict, 'Unknown');
});

test('guided runtime discovery, preview, launch rollback, restore, and no payment semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-profile-test-'));
  const executable = path.join(root, 'ollama.exe');
  await fs.writeFile(executable, 'fixture');
  const environment = { LOCALAPPDATA: root, ProgramFiles: path.join(root, 'pf') };
  const installedPath = path.join(root, 'Programs', 'Ollama', 'ollama.exe');
  await fs.mkdir(path.dirname(installedPath), { recursive: true }); await fs.copyFile(executable, installedPath);
  const configPath = path.join(root, 'Ollama', 'profile.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true }); await fs.writeFile(configPath, 'original bytes');
  let launchOptions;
  const spawn = (_exe, _args, options) => { launchOptions = options; const child = new EventEmitter(); child.pid = 123; queueMicrotask(() => child.emit('error', new Error('launch failed'))); return child; };
  const manager = createOllamaManager({ dataRoot: path.join(root, 'data'), environment, spawn, fetcher: async () => response({ version: '1' }) });
  try {
    const discovery = await manager.discover();
    assert.equal(discovery.runtimes[0].installed, true);
    assert.equal(manager.guidance().install.automaticInstallerAvailable, false);
    assert.doesNotMatch(JSON.stringify(manager.guidance()), /pay|purchase|subscription|trial/i);
    const inventory = await manager.profiles();
    const smokeProfile = inventory.profiles.find((profile) => profile.id === 'ollama-model-smoke');
    assert.equal(smokeProfile.ready, false);
    assert.deepEqual(smokeProfile.requiredValues, ['model']);
    assert.equal((await manager.profilePreflight('ollama-model-smoke')).code, 'PROFILE_VALUES_REQUIRED');
    await assert.rejects(manager.profileLaunch('ollama-model-smoke'), (error) => error.code === 'PROFILE_VALUES_REQUIRED');
    const preview = await manager.profilePreview('ollama-model-smoke', { model: 'gemma3:4b' });
    assert.equal(preview.shell, false); assert.equal(preview.windowsHide, true); assert.deepEqual(preview.args, ['run', 'gemma3:4b', 'Reply with OK.']);
    await assert.rejects(manager.profileLaunch('ollama-model-smoke', { model: 'gemma3:4b' }), /launch failed/);
    assert.equal(launchOptions.shell, false); assert.equal(launchOptions.windowsHide, true);
    const custom = { id: 'reviewed-profile', label: 'Reviewed profile', executable: installedPath, argsTemplate: ['serve'], placeholders: [], configMutations: [{ path: configPath, content: { mode: 'reviewed' } }] };
    await assert.rejects(manager.profileLaunch('reviewed-profile', {}, [custom]), /launch failed/);
    assert.equal(await fs.readFile(configPath, 'utf8'), 'original bytes');
    await assert.rejects(manager.profileLaunch('bad-path', {}, [{ ...custom, id: 'bad-path', configMutations: [{ path: path.join(root, 'outside.json'), content: {} }] }]), (error) => error.code === 'PROFILE_CONFIG_REJECTED');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('successful harness snapshots are rediscovered after manager restart and remain restorable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-snapshot-restart-test-'));
  const environment = { LOCALAPPDATA: root, ProgramFiles: path.join(root, 'pf') };
  const installedPath = path.join(root, 'Programs', 'Ollama', 'ollama.exe');
  await fs.mkdir(path.dirname(installedPath), { recursive: true });
  await fs.writeFile(installedPath, 'fixture');
  const spawn = () => { const child = new EventEmitter(); child.pid = 456; return child; };
  try {
    const first = createOllamaManager({ dataRoot: path.join(root, 'data'), environment, spawn, fetcher: async () => response({ version: '1' }) });
    const launched = await first.profileLaunch('ollama-serve');
    assert.equal(launched.launched, true);
    const restarted = createOllamaManager({ dataRoot: path.join(root, 'data'), environment, spawn, fetcher: async () => response({ version: '1' }) });
    const inventory = await restarted.profiles();
    assert.equal(inventory.snapshots.length, 1);
    assert.equal(inventory.snapshots[0].snapshotId, launched.snapshotId);
    assert.equal(inventory.snapshots[0].restorable, true);
    assert.deepEqual(await restarted.profileRestore(launched.snapshotId), { restored: true, snapshotId: launched.snapshotId });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('chat history persists only bounded metadata and sanitizes unexpected failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ollama-history-test-'));
  const manager = createOllamaManager({ dataRoot: root, fetcher: async () => response({ version: '1' }) });
  try {
    const metadata = { id: 'chat-1', title: 'Local chat', model: 'gemma3:4b', messageCount: 2, createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:01:00Z' };
    await manager.historyUpsert(metadata);
    assert.deepEqual(await manager.historyList(), [metadata]);
    await assert.rejects(manager.historyUpsert({ ...metadata, messages: [{ content: 'secret' }] }), (error) => error.code === 'INVALID_INPUT');
    assert.deepEqual(publicError(new Error('C:\\private\\token=secret')), { code: 'OLLAMA_FAILED', message: 'The Ollama operation could not be completed.', recovery: 'Check the in-app Ollama status and recovery guidance.' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
