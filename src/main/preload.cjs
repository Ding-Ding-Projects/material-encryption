'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
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
