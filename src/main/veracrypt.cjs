'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

function candidates(name) {
  return [
    path.join(PROGRAM_FILES, 'VeraCrypt', name),
    path.join(PROGRAM_FILES_X86, 'VeraCrypt', name)
  ];
}

function findBinary(name = 'VeraCrypt.exe') {
  return candidates(name).find((candidate) => fs.existsSync(candidate)) || null;
}

function validateDriveLetter(value) {
  if (!/^[A-Z]:?$/i.test(String(value || ''))) throw new Error('Select a drive letter from A through Z.');
  return String(value).slice(0, 1).toUpperCase();
}

function validateVolume(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Choose a volume file or device first.');
  if (input.includes('\0') || /[\r\n]/.test(input)) throw new Error('The volume path contains unsupported characters.');
  if (/^ID:[0-9A-F]{64}$/i.test(input) || /^\\\\\?\\Volume\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}\\$/i.test(input) || /^\\Device\\Harddisk\d+\\Partition\d+$/i.test(input)) return input;
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) throw new Error('The selected volume does not exist.');
  return resolved;
}

function run(binary, args, { wait = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!binary) return reject(new Error('VeraCrypt is not installed. Install it from veracrypt.fr and try again.'));
    const child = spawn(binary, args, {
      windowsHide: true,
      detached: !wait,
      stdio: wait ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      shell: false
    });
    if (!wait) {
      child.unref();
      resolve({ ok: true, exitCode: null });
      return;
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => { if (stderr.length < 8192) stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ ok: true, exitCode: 0 });
      else reject(new Error(stderr.trim() || `VeraCrypt exited with code ${code}.`));
    });
  });
}

async function getStatus() {
  const executable = findBinary();
  const formatExecutable = findBinary('VeraCrypt Format.exe');
  return {
    installed: Boolean(executable && formatExecutable),
    executable,
    formatExecutable,
    version: executable ? fs.statSync(executable).mtime.toISOString() : null,
    mountedVolumes: [],
    mountedState: 'Open VeraCrypt for authoritative mounted-volume state.'
  };
}

async function mount({ volume, driveLetter, readOnly = false, removable = false, preserveHistory = false }) {
  const args = ['/volume', validateVolume(volume), '/letter', validateDriveLetter(driveLetter), '/history', preserveHistory ? 'y' : 'n', '/auto'];
  if (readOnly) args.push('/mountoption', 'ro');
  if (removable) args.push('/mountoption', 'rm');
  // Deliberately omit /password. VeraCrypt owns its secure password prompt.
  return run(findBinary(), args, { wait: false });
}

async function unmount({ driveLetter, force = false }) {
  const args = ['/quit', '/unmount', validateDriveLetter(driveLetter)];
  if (force) args.push('/force');
  return run(findBinary(), args);
}

async function unmountAll({ force = false } = {}) {
  const args = ['/quit', '/unmount'];
  if (force) args.push('/force');
  return run(findBinary(), args);
}

async function wipeCache() {
  return run(findBinary(), ['/quit', '/wipecache']);
}

async function autoMountDevices() {
  return run(findBinary(), ['/auto', 'devices'], { wait: false });
}

async function openNative(surface = 'main') {
  const table = {
    main: [findBinary(), []],
    preferences: [findBinary(), ['/quit', 'preferences']],
    format: [findBinary('VeraCrypt Format.exe'), []]
  };
  if (!table[surface]) throw new Error('That VeraCrypt surface is not allowlisted.');
  return run(table[surface][0], table[surface][1], { wait: false });
}

module.exports = { getStatus, mount, unmount, unmountAll, wipeCache, autoMountDevices, openNative, validateDriveLetter, validateVolume };
