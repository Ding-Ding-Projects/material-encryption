import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

test('Ollama cancellation preserves operation identifiers and kind selectors across the bridge', async () => {
  const [preload, main, design] = await Promise.all([
    fs.readFile(path.join(root, 'src/main/preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src/main/main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'design/VeraCrypt Material.dc.html'), 'utf8')
  ]);
  assert.match(preload, /typeof operation === 'string' \? \{ operationId: operation \} : \{ operationId: operation\?\.operationId, kind: operation\?\.kind \}/);
  assert.match(main, /p\.operationId \|\| p\.kind/);
  assert.match(design, /cancelOllamaOperation\(\{ operationId: s\.ollamaOperationId \|\| undefined, kind: 'pull' \}\)/);
  assert.match(design, /cancelOllamaOperation\(\{ kind: 'chat' \}\)/);

  const calls = [];
  let bridge;
  vm.runInNewContext(preload, {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
        ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } }
      };
    },
    Object, Array, JSON, Number, String, Error, Promise
  });
  await bridge.cancelOllamaOperation('operation-123');
  await bridge.cancelOllamaOperation({ kind: 'chat' });
  assert.equal(calls[0][0], 'ollama:cancel');
  assert.equal(calls[0][1].operationId, 'operation-123');
  assert.equal(calls[1][0], 'ollama:cancel');
  assert.equal(calls[1][1].kind, 'chat');
});

test('Ollama renderer and service use honest complete-response chat semantics', async () => {
  const [manager, main, design] = await Promise.all([
    fs.readFile(path.join(root, 'src/main/ollama-manager.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src/main/main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'design/VeraCrypt Material.dc.html'), 'utf8')
  ]);
  assert.match(manager, /body: \{ model: modelName\(model\), messages: validateMessages\(messages, system\), options: validateChatOptions\(chatOptions\), stream: false \}/);
  assert.match(manager, /delivery: 'complete', progress: 'indeterminate-bounded'/);
  assert.match(main, /content: \(await operation\.promise\)\.content/);
  assert.doesNotMatch(design, /Streaming from the local model|A response is streaming|stream: true/);
  assert.match(design, /Waiting for one complete bounded response/);
});

test('catalog, cart, harness, and restore contracts fail closed on missing evidence', async () => {
  const [preload, manager, design] = await Promise.all([
    fs.readFile(path.join(root, 'src/main/preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src/main/ollama-manager.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'design/VeraCrypt Material.dc.html'), 'utf8')
  ]);
  assert.match(manager, /MODEL_SIZE_UNKNOWN/);
  assert.match(manager, /DISK_PREFLIGHT_UNAVAILABLE/);
  assert.match(manager, /available: downloadable, downloadable/);
  assert.match(design, /storage preflight cannot authorize this download/);
  assert.match(manager, /PROFILE_VALUES_REQUIRED/);
  assert.match(design, /harnessValues = profile => .*selectedChatModel/s);
  assert.match(design, /launchHarness\(\{ profileId: profile\.id, values \}\)/);
  assert.match(manager, /profiles: async .*snapshots: await listSnapshots/s);
  assert.match(preload, /listHarnessProfiles: \(\) => invoke\('ollama:profiles'\)/);
  assert.match(design, /value\?\.snapshots/);
  assert.doesNotMatch(design, /Settings → Update/);
});
