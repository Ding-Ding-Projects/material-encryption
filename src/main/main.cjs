'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const vc = require('./veracrypt.cjs');
const locks = require('./credential-store.cjs');

let mainWindow;

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
