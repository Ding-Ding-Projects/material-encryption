'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, shell } = require('electron');
const vc = require('./veracrypt.cjs');
const locks = require('./credential-store.cjs');
const converter = require('./file-converter.cjs');
const ollama = require('./ollama-manager.cjs');
const logos = require('./logo-service.cjs');

let mainWindow;
let converterService;
let ollamaService;
let logoService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 360,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#131314',
    title: 'Material Encryption',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'material-encryption-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?(veracrypt\.fr|github\.com)\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

function assertTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame.url !== mainWindow.webContents.getURL()) {
    throw new Error('Untrusted renderer frame.');
  }
}

function record(value, name = 'Payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false.`);
  return value;
}

function boundedText(value, name, max = 512, allowNewlines = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0') || (!allowNewlines && /[\r\n]/.test(value))) throw new Error(`${name} is invalid.`);
  return value;
}

function exactRecord(value, allowedKeys, name = 'Payload') {
  const payload = record(value, name);
  const unknown = Object.keys(payload).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new Error(`${name} contains unsupported fields.`);
  return payload;
}

function boundedStringArray(value, name, { maxItems = Number.POSITIVE_INFINITY, maxLength = 64 } = {}) {
  if (!Array.isArray(value) || !value.length || value.length > maxItems || value.some((entry) => typeof entry !== 'string' || !entry || entry.length > maxLength || entry.includes('\0'))) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function converterPayload(value, allowedKeys) {
  return exactRecord(value, allowedKeys, 'Converter payload');
}

function converterRegister(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertTrustedSender(event);
      return { ok: true, value: await callback(payload || {}) };
    } catch (error) {
      const safe = converter.publicError(error);
      return { ok: false, error: safe.message, code: safe.code };
    }
  });
}

function register(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertTrustedSender(event);
      return { ok: true, value: await callback(payload || {}) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

app.whenReady().then(() => {
  converterService = converter.createConverterService({ dialog, nativeImage, ownerWindow: () => mainWindow, queueStatePath: path.join(app.getPath('userData'), 'conversion-queue.v1.json') });
  ollamaService = ollama.createOllamaManager({ dataRoot: path.join(app.getPath('userData'), 'ollama') });
  logoService = logos.createLogoService({ dialog, ownerWindow: () => mainWindow, dataRoot: path.join(app.getPath('userData'), 'custom-logo') });
  protocol.handle('material-logo', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'asset' || url.pathname !== '/png' || [...url.searchParams.keys()].some((key) => !['id', 'size'].includes(key))) throw new Error('Unsupported logo request.');
      const bytes = await logoService.asset(url.searchParams.get('id'), Number(url.searchParams.get('size')));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (_) { return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
  });
  createWindow();

  register('vc:status', () => vc.getStatus());
  register('vc:mount', (value) => {
    const payload = record(value);
    return vc.mount({
      volume: boundedText(payload.volume, 'Volume', 2048),
      driveLetter: boundedText(payload.driveLetter, 'Drive letter', 2),
      readOnly: boolean(payload.readOnly, 'readOnly'),
      removable: boolean(payload.removable, 'removable'),
      preserveHistory: boolean(payload.preserveHistory, 'preserveHistory')
    });
  });
  register('vc:unmount', (value) => {
    const payload = record(value);
    return vc.unmount({ driveLetter: boundedText(payload.driveLetter, 'Drive letter', 2), force: boolean(payload.force, 'force') });
  });
  register('vc:unmount-all', (value) => {
    const payload = record(value);
    return vc.unmountAll({ force: boolean(payload.force, 'force') });
  });
  register('vc:wipe-cache', () => vc.wipeCache());
  register('vc:auto-mount-devices', () => vc.autoMountDevices());
  register('vc:open-native', (value) => vc.openNative(boundedText(record(value).surface, 'Surface', 32)));

  register('file:select-volume', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select a VeraCrypt volume', properties: ['openFile'], filters: [{ name: 'Encrypted volumes', extensions: ['hc', 'tc'] }, { name: 'All files', extensions: ['*'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  register('file:select-device', () => vc.openNative('main'));
  register('file:select-vocabulary', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select personal vocabulary JSON', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  register('file:export-view', async (value) => {
    const { format, content } = record(value);
    const allowed = new Map([
      ['Markdown', 'md'], ['Plain text', 'txt'], ['JSON', 'json'], ['JSONL', 'jsonl'],
      ['YAML', 'yaml'], ['TOML', 'toml'], ['XML', 'xml'], ['CSV', 'csv'], ['TSV', 'tsv'],
      ['HTML', 'html'], ['SQL', 'sql'], ['TypeScript', 'ts'], ['Python', 'py'], ['Go', 'go'],
      ['Rust', 'rs'], ['Protobuf', 'proto'], ['JSON Schema', 'schema.json']
    ]);
    if (!allowed.has(format)) throw new Error('Choose a supported export format.');
    boundedText(content, 'Export content', 2 * 1024 * 1024, true);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export current view', defaultPath: `material-encryption-view.${allowed.get(format)}`, filters: [{ name: format, extensions: [allowed.get(format).split('.').at(-1)] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  const logoRegister = (channel, callback) => ipcMain.handle(channel, async (event, payload) => {
    try { assertTrustedSender(event); return { ok: true, value: await callback(payload || {}) }; }
    catch (error) { const safe = logos.publicError(error); return { ok: false, error: safe.message, code: safe.code }; }
  });
  const logoPayload = (value, keys) => exactRecord(value, keys, 'Logo payload');
  logoRegister('logo:select', (value) => { logoPayload(value, []); return logoService.select(); });
  logoRegister('logo:state', (value) => { logoPayload(value, []); return logoService.state(); });
  logoRegister('logo:preview', (value) => { const payload = logoPayload(value, ['token', 'options']); return logoService.preview({ token: payload.token == null ? null : boundedText(payload.token, 'Logo selection token', 64), options: logoPayload(payload.options || {}, ['fit', 'background', 'focalX', 'focalY', 'cropZoom']) }); });
  logoRegister('logo:apply', (value) => { const payload = logoPayload(value, ['token', 'options']); return logoService.apply({ token: payload.token == null ? null : boundedText(payload.token, 'Logo selection token', 64), options: logoPayload(payload.options || {}, ['fit', 'background', 'focalX', 'focalY', 'cropZoom']) }); });
  logoRegister('logo:reset', (value) => { logoPayload(value, []); return logoService.reset(); });

  converterRegister('converter:select-input', (value) => {
    converterPayload(value, []);
    return converterService.selectInput();
  });
  converterRegister('converter:select-batch-inputs', (value) => {
    converterPayload(value, []);
    return converterService.selectBatchInputs();
  });
  converterRegister('converter:inspect', (value) => {
    const payload = converterPayload(value, ['inputToken']);
    return converterService.inspect({ inputToken: boundedText(payload.inputToken, 'Input selection token', 64) });
  });
  converterRegister('converter:preview', (value) => {
    const payload = converterPayload(value, ['inputToken', 'targetFormat']);
    return converterService.preview({ inputToken: boundedText(payload.inputToken, 'Input selection token', 64), targetFormat: boundedText(payload.targetFormat, 'Target format', 16) });
  });
  converterRegister('converter:save', (value) => {
    const payload = converterPayload(value, ['inputToken', 'targetFormat', 'confirmOverwrite']);
    return converterService.save({
      inputToken: boundedText(payload.inputToken, 'Input selection token', 64),
      targetFormat: boundedText(payload.targetFormat, 'Target format', 16),
      confirmOverwrite: boolean(payload.confirmOverwrite, 'confirmOverwrite')
    });
  });
  converterRegister('converter:select-destination', (value) => {
    converterPayload(value, []);
    return converterService.selectDestination();
  });
  converterRegister('converter:select-folder', (value) => {
    converterPayload(value, []);
    return converterService.selectFolder();
  });
  converterRegister('converter:plan-batch', (value) => {
    const payload = converterPayload(value, ['inputTokens', 'targetFormat', 'destinationToken']);
    return converterService.planBatch({
      inputTokens: boundedStringArray(payload.inputTokens, 'Input selection tokens'),
      targetFormat: boundedText(payload.targetFormat, 'Target format', 16),
      destinationToken: boundedText(payload.destinationToken, 'Destination selection token', 64)
    });
  });
  converterRegister('converter:run-batch', (value) => {
    const payload = converterPayload(value, ['inputTokens', 'targetFormat', 'destinationToken', 'confirmOverwrite']);
    return converterService.runBatch({
      inputTokens: boundedStringArray(payload.inputTokens, 'Input selection tokens'),
      targetFormat: boundedText(payload.targetFormat, 'Target format', 16),
      destinationToken: boundedText(payload.destinationToken, 'Destination selection token', 64),
      confirmOverwrite: boolean(payload.confirmOverwrite, 'confirmOverwrite')
    });
  });
  converterRegister('converter:registry', (value) => {
    converterPayload(value, []);
    return converterService.getFormatRegistry();
  });
  converterRegister('converter:pdf-plan', (value) => {
    const payload = converterPayload(value, ['operation', 'inputTokens', 'destinationToken', 'options']);
    return converterService.planPdf({
      operation: boundedText(payload.operation, 'PDF operation', 32),
      inputTokens: boundedStringArray(payload.inputTokens, 'PDF input selection tokens'),
      destinationToken: payload.destinationToken == null ? null : boundedText(payload.destinationToken, 'Destination selection token', 64),
      options: exactRecord(payload.options || {}, ['pages', 'pageOrder', 'ranges', 'angle', 'metadata', 'outputName', 'outputNames'], 'PDF options')
    });
  });
  converterRegister('converter:pdf-execute', (value) => {
    const payload = converterPayload(value, ['planToken', 'confirmOverwrite']);
    return converterService.executePdf({ planToken: boundedText(payload.planToken, 'PDF plan token', 64), confirmOverwrite: boolean(payload.confirmOverwrite, 'confirmOverwrite') });
  });
  converterRegister('converter:queue-enqueue', (value) => {
    const payload = converterPayload(value, ['inputTokens', 'destinationToken', 'rule', 'groupRules']);
    return converterService.enqueueBatch({
      inputTokens: boundedStringArray(payload.inputTokens, 'Input selection tokens'),
      destinationToken: boundedText(payload.destinationToken, 'Destination selection token', 64),
      rule: exactRecord(payload.rule, ['targetFormat', 'group'], 'Queue rule'),
      groupRules: record(payload.groupRules || {}, 'Queue group rules')
    });
  });
  converterRegister('converter:queue-enqueue-folder', (value) => {
    const payload = converterPayload(value, ['folderToken', 'destinationToken', 'rule', 'groupRules', 'recursive', 'extensions']);
    return converterService.enqueueFolder({
      folderToken: boundedText(payload.folderToken, 'Folder selection token', 64),
      destinationToken: boundedText(payload.destinationToken, 'Destination selection token', 64),
      rule: exactRecord(payload.rule, ['targetFormat', 'group'], 'Queue rule'),
      groupRules: record(payload.groupRules || {}, 'Queue group rules'),
      recursive: boolean(payload.recursive, 'recursive'),
      extensions: payload.extensions == null ? [] : boundedStringArray(payload.extensions, 'Folder extension filters', { maxLength: 16 })
    });
  });
  for (const [channel, method] of [['snapshot', 'queueSnapshot'], ['preflight', 'queuePreflight'], ['resume', 'queueResume'], ['pause', 'queuePause'], ['cancel', 'queueCancel']]) {
    converterRegister(`converter:queue-${channel}`, (value) => { converterPayload(value, []); return converterService[method](); });
  }
  converterRegister('converter:queue-retry', (value) => {
    const payload = converterPayload(value, ['jobIds']);
    return converterService.queueRetry({ jobIds: payload.jobIds == null ? null : boundedStringArray(payload.jobIds, 'Queue job identifiers', { maxLength: 64 }) });
  });

  const ollamaRegister = (channel, callback) => ipcMain.handle(channel, async (event, payload) => {
    try { assertTrustedSender(event); return { ok: true, value: await callback(payload || {}) }; }
    catch (error) { const safe = ollama.publicError(error); return { ok: false, error: safe.message, code: safe.code, recovery: safe.recovery }; }
  });
  const ollamaPayload = (value, keys) => exactRecord(value, keys, 'Ollama payload');
  ollamaRegister('ollama:guidance', (value) => { ollamaPayload(value, []); return ollamaService.guidance(); });
  ollamaRegister('ollama:discover', (value) => { ollamaPayload(value, []); return ollamaService.discover(); });
  ollamaRegister('ollama:health', (value) => { ollamaPayload(value, []); return ollamaService.health(); });
  ollamaRegister('ollama:list', (value) => { ollamaPayload(value, []); return ollamaService.list(); });
  ollamaRegister('ollama:show', (value) => { const p = ollamaPayload(value, ['model']); return ollamaService.show(boundedText(p.model, 'Model', 200)); });
  ollamaRegister('ollama:pull', async (value) => { const p = ollamaPayload(value, ['model']); const operation = ollamaService.pull(boundedText(p.model, 'Model', 200)); return { operationId: operation.operationId, result: await operation.promise }; });
  ollamaRegister('ollama:cancel', (value) => { const p = ollamaPayload(value, ['operationId', 'kind']); return ollamaService.cancel(boundedText(p.operationId || p.kind, 'Operation id or kind', 64)); });
  ollamaRegister('ollama:delete', (value) => { const p = ollamaPayload(value, ['model', 'confirmed']); return ollamaService.delete(boundedText(p.model, 'Model', 200), boolean(p.confirmed, 'confirmed')); });
  ollamaRegister('ollama:pull-batch', (value) => { const p = ollamaPayload(value, ['items', 'concurrency']); return ollamaService.pullBatch(p.items, { concurrency: p.concurrency }); });
  ollamaRegister('ollama:chat', async (value) => { const p = ollamaPayload(value, ['model', 'tag', 'system', 'messages', 'options', 'stream']); const operation = ollamaService.chat({ ...p, model: p.tag ? `${p.model}:${p.tag}` : p.model }); return { operationId: operation.operationId, content: (await operation.promise).content }; });
  ollamaRegister('ollama:catalog', (value) => { ollamaPayload(value, []); return ollamaService.catalogStore(); });
  ollamaRegister('ollama:hardware', (value) => { ollamaPayload(value, []); return ollamaService.hardware(); });
  ollamaRegister('ollama:fit', (value) => { const p = ollamaPayload(value, ['model', 'hardware']); return ollamaService.evaluateFit(p.model, p.hardware); });
  ollamaRegister('ollama:profiles', (value) => { ollamaPayload(value, []); return ollamaService.profiles(); });
  ollamaRegister('ollama:profile-preflight', (value) => { const p = ollamaPayload(value, ['profileId', 'values']); return ollamaService.profilePreflight(boundedText(p.profileId, 'Profile id', 64), p.values || {}); });
  ollamaRegister('ollama:profile-preview', (value) => { const p = ollamaPayload(value, ['profileId', 'values']); return ollamaService.profilePreview(boundedText(p.profileId, 'Profile id', 64), p.values || {}); });
  ollamaRegister('ollama:profile-launch', (value) => { const p = ollamaPayload(value, ['profileId', 'values']); return ollamaService.profileLaunch(boundedText(p.profileId, 'Profile id', 64), p.values || {}); });
  ollamaRegister('ollama:profile-restore', (value) => { const p = ollamaPayload(value, ['snapshotId']); return ollamaService.profileRestore(boundedText(p.snapshotId, 'Snapshot id', 64)); });
  ollamaRegister('ollama:history-list', (value) => { ollamaPayload(value, []); return ollamaService.historyList(); });
  ollamaRegister('ollama:history-upsert', (value) => ollamaService.historyUpsert(ollamaPayload(value, ['id', 'title', 'model', 'messageCount', 'createdAt', 'updatedAt'])));
  ollamaRegister('ollama:history-delete', (value) => { const p = ollamaPayload(value, ['id']); return ollamaService.historyDelete(boundedText(p.id, 'History id', 64)); });

  register('locks:list', () => locks.listLocks());
  register('locks:begin-otp', (value) => { const payload = record(value); return locks.beginOtp({ targetId: boundedText(payload.targetId, 'Target identifier', 240), targetLabel: boundedText(payload.targetLabel, 'Target label', 240) }); });
  register('locks:create', (value) => locks.createLock(record(value)));
  register('locks:verify', (value) => locks.verifyLock(record(value)));
  register('locks:remove', (value) => locks.removeLock(record(value)));

  register('app:open-data', () => shell.openPath(app.getPath('userData')));
  register('app:get-data-path', () => app.getPath('userData'));
  register('window:minimize', () => mainWindow.minimize());
  register('window:toggle-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  register('window:close', () => mainWindow.close());
});

app.on('window-all-closed', () => app.quit());
