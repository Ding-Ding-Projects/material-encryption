'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const pdfPages = (value) => {
  if (typeof value !== 'string' || !value.trim()) return [];
  const pages = [];
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('PDF pages must use comma-separated page numbers or ranges such as 1-3,5.');
    const start = Number(match[1]); const end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 511) throw new Error('PDF page range is invalid or too large.');
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return pages;
};
const pdfRanges = (value) => {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((part) => {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('PDF pages must use comma-separated page numbers or ranges such as 1-3,5.');
    const start = Number(match[1]); const end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 511) throw new Error('PDF page range is invalid or too large.');
    return { start, end };
  });
};
const normalizePdfTool = (payload = {}) => {
  const action = payload.action || payload.operation;
  const operation = ({ extract: 'extract-pages', metadata: 'edit-metadata' })[action] || action;
  const options = {};
  const pages = pdfPages(payload.ranges || '');
  if (operation === 'split' && payload.ranges?.trim()) options.ranges = pdfRanges(payload.ranges);
  if (operation === 'extract-pages') options.pages = pages;
  if (operation === 'reorder') options.pageOrder = pages;
  if (operation === 'rotate') { options.pages = pages; options.angle = Number(payload.angle); }
  if (operation === 'edit-metadata') options.metadata = typeof payload.metadata === 'string' ? JSON.parse(payload.metadata) : payload.metadata;
  return { operation, inputTokens: payload.inputTokens, destinationToken: payload.destinationToken, options };
};
const enqueueInChunks = async (payload = {}) => {
  if (!Array.isArray(payload.inputTokens) || !payload.inputTokens.length) return invoke('converter:queue-enqueue', payload);
  const added = [];
  for (let offset = 0; offset < payload.inputTokens.length; offset += 128) {
    const result = await invoke('converter:queue-enqueue', { ...payload, inputTokens: payload.inputTokens.slice(offset, offset + 128) });
    if (!result?.ok) return result;
    if (Array.isArray(result.value)) added.push(...result.value);
  }
  return { ok: true, value: added };
};
contextBridge.exposeInMainWorld('materialEncryption', Object.freeze({
  getStatus: () => invoke('vc:status'),
  mount: (options) => invoke('vc:mount', options),
  unmount: (options) => invoke('vc:unmount', options),
  unmountAll: (options) => invoke('vc:unmount-all', options),
  wipeCache: () => invoke('vc:wipe-cache'),
  autoMountDevices: () => invoke('vc:auto-mount-devices'),
  openNative: (surface) => invoke('vc:open-native', { surface }),
  selectVolume: () => invoke('file:select-volume'),
  selectDevice: () => invoke('file:select-device'),
  selectVocabulary: () => invoke('file:select-vocabulary'),
  exportView: (payload) => invoke('file:export-view', payload),
  selectLogoImage: () => invoke('logo:select'),
  getLogoState: () => invoke('logo:state'),
  previewLogo: (payload) => invoke('logo:preview', payload),
  applyLogo: (payload) => invoke('logo:apply', payload),
  resetLogo: () => invoke('logo:reset'),
  selectConverterInput: () => invoke('converter:select-input'),
  selectConverterBatchInputs: () => invoke('converter:select-batch-inputs'),
  inspectConverterInput: (payload) => invoke('converter:inspect', payload),
  previewConversion: (payload) => invoke('converter:preview', payload),
  saveConversion: (payload) => invoke('converter:save', payload),
  selectConverterDestination: () => invoke('converter:select-destination'),
  selectConverterFolder: () => invoke('converter:select-folder'),
  planConverterBatch: (payload) => invoke('converter:plan-batch', payload),
  runConverterBatch: (payload) => invoke('converter:run-batch', payload),
  getConverterRegistry: () => invoke('converter:registry'),
  planPdfTool: (payload) => invoke('converter:pdf-plan', normalizePdfTool(payload)),
  executePdfTool: (payload) => invoke('converter:pdf-execute', payload),
  inspectPdfTool: (payload) => invoke('converter:pdf-plan', { operation: 'inspect', inputTokens: payload.inputTokens, options: {} }),
  enqueueConverterBatch: enqueueInChunks,
  enqueueConverterFolder: (payload) => invoke('converter:queue-enqueue-folder', payload),
  getConverterQueue: () => invoke('converter:queue-snapshot'),
  preflightConverterQueue: () => invoke('converter:queue-preflight'),
  resumeConverterQueue: () => invoke('converter:queue-resume'),
  pauseConverterQueue: () => invoke('converter:queue-pause'),
  cancelConverterQueue: () => invoke('converter:queue-cancel'),
  retryConverterQueue: (payload) => invoke('converter:queue-retry', payload),
  selectConversionInputs: () => invoke('converter:select-batch-inputs'),
  inspectConversion: (payload) => invoke('converter:inspect', payload),
  planConversions: (payload) => invoke('converter:plan-batch', payload),
  convertFiles: (payload) => invoke('converter:run-batch', payload),
  getOllamaGuidance: () => invoke('ollama:guidance'),
  discoverOllama: () => invoke('ollama:discover'),
  getOllamaHealth: () => invoke('ollama:health'),
  listOllamaModels: () => invoke('ollama:list'),
  showOllamaModel: (model) => invoke('ollama:show', { model }),
  pullOllamaModel: (model) => invoke('ollama:pull', { model }),
  cancelOllamaOperation: (operation) => invoke('ollama:cancel', typeof operation === 'string' ? { operationId: operation } : { operationId: operation?.operationId, kind: operation?.kind }),
  deleteOllamaModel: (model, confirmed) => invoke('ollama:delete', { model, confirmed }),
  pullOllamaCart: (payload) => invoke('ollama:pull-batch', payload),
  chatWithOllama: (payload) => invoke('ollama:chat', payload),
  getOllamaCatalog: () => invoke('ollama:catalog'),
  getOllamaHardware: () => invoke('ollama:hardware'),
  evaluateOllamaFit: (payload) => invoke('ollama:fit', payload),
  listOllamaHarnessProfiles: () => invoke('ollama:profiles'),
  preflightOllamaHarness: (payload) => invoke('ollama:profile-preflight', payload),
  previewOllamaHarness: (payload) => invoke('ollama:profile-preview', payload),
  launchOllamaHarness: (payload) => invoke('ollama:profile-launch', payload),
  restoreOllamaHarness: (snapshotId) => invoke('ollama:profile-restore', { snapshotId }),
  listOllamaChatHistory: () => invoke('ollama:history-list'),
  saveOllamaChatMetadata: (payload) => invoke('ollama:history-upsert', payload),
  deleteOllamaChatMetadata: (id) => invoke('ollama:history-delete', { id }),
  ollamaHealth: () => invoke('ollama:health'),
  listModels: () => invoke('ollama:catalog'),
  showModel: (payload) => invoke('ollama:show', { model: payload.tag ? `${payload.model}:${payload.tag}` : payload.model }),
  pullModel: (payload) => invoke('ollama:pull', { model: payload.tag ? `${payload.model}:${payload.tag}` : payload.model }),
  pullModelCart: (payload) => invoke('ollama:pull-batch', { items: (payload.models || []).map((item) => ({ name: item.tag ? `${item.model}:${item.tag}` : item.model, sizeBytes: item.expectedBytes })), concurrency: 2 }),
  chatOllama: (payload) => invoke('ollama:chat', payload),
  listHarnessProfiles: () => invoke('ollama:profiles'),
  launchHarness: (payload) => invoke('ollama:profile-launch', payload),
  restoreHarness: (payload) => invoke('ollama:profile-restore', payload),
  listLocks: () => invoke('locks:list'),
  beginOtp: (payload) => invoke('locks:begin-otp', payload),
  createLock: (payload) => invoke('locks:create', payload),
  verifyLock: (payload) => invoke('locks:verify', payload),
  removeLock: (payload) => invoke('locks:remove', payload),
  openDataFolder: () => invoke('app:open-data'),
  getDataPath: () => invoke('app:get-data-path'),
  minimize: () => invoke('window:minimize'),
  toggleMaximize: () => invoke('window:toggle-maximize'),
  close: () => invoke('window:close')
}));
