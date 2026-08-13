'use strict';

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const elevation = require('./elevation.cjs');


const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

// Nothing is bundled and nothing is installed by this app. These paths only
// detect a VeraCrypt the user already chose to install, which unlocks the one
// capability that cannot be implemented in user space: assigning a drive letter.
function candidates(name) {
  return [
    path.join(PROGRAM_FILES, 'VeraCrypt', name),
    path.join(PROGRAM_FILES_X86, 'VeraCrypt', name)
  ];
}

function findBinary(name = 'VeraCrypt.exe') {
  return candidates(name).find((candidate) => fs.existsSync(candidate)) || null;
}

function binarySource(name = 'VeraCrypt.exe') {
  return findBinary(name) ? 'installed' : 'missing';
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

function powershell(script, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).trim().slice(0, 2048)));
      resolve(String(stdout));
    });
  });
}

// Reads the real NT device target behind each mounted drive letter. A VeraCrypt
// volume resolves to \Device\VeraCryptVolume<letter>, which no other driver uses,
// so this is authoritative rather than a guess from the volume label.
const LIST_VOLUMES_SCRIPT = `
$ErrorActionPreference = 'Stop'
if (-not ('MaterialEncryption.Dos' -as [type])) {
  Add-Type -Namespace MaterialEncryption -Name Dos -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern uint QueryDosDevice(string lpDeviceName, System.Text.StringBuilder lpTargetPath, uint ucchMax);
'@
}
$disks = @{}
foreach ($disk in Get-CimInstance -ClassName Win32_LogicalDisk) { $disks[$disk.DeviceID] = $disk }
$rows = @()
foreach ($letter in [char[]]([char]'A'..[char]'Z')) {
  $dos = "$letter" + ':'
  $buffer = New-Object System.Text.StringBuilder 512
  if ([MaterialEncryption.Dos]::QueryDosDevice($dos, $buffer, 512) -eq 0) { continue }
  $target = $buffer.ToString()
  $disk = $disks[$dos]
  $rows += [pscustomobject]@{
    letter = $dos
    device = $target
    veracrypt = [bool]($target -like '*VeraCryptVolume*')
    label = if ($disk) { $disk.VolumeName } else { $null }
    fileSystem = if ($disk) { $disk.FileSystem } else { $null }
    sizeBytes = if ($disk -and $disk.Size) { [double]$disk.Size } else { $null }
    freeBytes = if ($disk -and $disk.FreeSpace) { [double]$disk.FreeSpace } else { $null }
    driveType = if ($disk) { [int]$disk.DriveType } else { 0 }
  }
}
ConvertTo-Json -InputObject @($rows) -Depth 3 -Compress
`;

const DRIVE_TYPES = { 0: 'Unknown', 1: 'No root directory', 2: 'Removable', 3: 'Local disk', 4: 'Network', 5: 'Optical', 6: 'RAM disk' };

function normalizeVolumeRow(row) {
  const letter = String(row.letter || '').slice(0, 2).toUpperCase();
  return {
    letter,
    device: typeof row.device === 'string' ? row.device : '',
    mounted: Boolean(row.veracrypt),
    label: row.label || '',
    fileSystem: row.fileSystem || '',
    sizeBytes: Number.isFinite(row.sizeBytes) ? row.sizeBytes : null,
    freeBytes: Number.isFinite(row.freeBytes) ? row.freeBytes : null,
    driveType: DRIVE_TYPES[row.driveType] || 'Unknown'
  };
}

// Querying the drive letters costs a PowerShell process and about a second, and
// the renderer polls. Serving the last result immediately while one refresh runs
// in the background keeps the table populated across reloads and stops the poll
// spawning a process every few seconds.
let driveCache = null;
let driveRefresh = null;
const DRIVE_CACHE_MS = 4000;

async function listDrives({ refresh = false } = {}) {
  const fresh = driveCache && Date.now() - driveCache.at < DRIVE_CACHE_MS;
  if (!refresh && fresh) return driveCache.value;
  if (!driveRefresh) {
    driveRefresh = queryDrives()
      .then((value) => { driveCache = { at: Date.now(), value }; return value; })
      .finally(() => { driveRefresh = null; });
  }
  // A cached answer, however old, beats an empty table while a query is running.
  if (driveCache && !refresh) {
    driveRefresh.catch(() => {});
    return driveCache.value;
  }
  return driveRefresh;
}

// Every letter A–Z, with the ones currently in use annotated from live system
// state. Letters with no device are genuinely free mount targets.
async function queryDrives() {
  const alphabet = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`);
  let rows = [];
  let error = null;
  try {
    const output = (await powershell(LIST_VOLUMES_SCRIPT)).trim();
    const parsed = output ? JSON.parse(output) : [];
    rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(normalizeVolumeRow);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const byLetter = new Map(rows.map((row) => [row.letter, row]));
  return {
    error,
    queriedAt: new Date().toISOString(),
    drives: alphabet.map((letter) => byLetter.get(letter) || {
      letter, device: '', mounted: false, label: '', fileSystem: '', sizeBytes: null, freeBytes: null, driveType: error ? 'Unknown' : 'Free'
    })
  };
}

async function readVersion(executable) {
  if (!executable) return null;
  try {
    const output = await powershell(`(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`, { timeout: 10000 });
    return output.trim() || null;
  } catch (_) {
    return null;
  }
}

async function getStatus() {
  const executable = findBinary();
  const formatExecutable = findBinary('VeraCrypt Format.exe');
  const installed = Boolean(executable && formatExecutable);
  const [version, listing] = await Promise.all([readVersion(executable), listDrives()]);
  const mountedVolumes = listing.drives.filter((drive) => drive.mounted);
  return {
    installed,
    executable,
    formatExecutable,
    version,
    source: binarySource(),
    elevated: elevation.isElevated(),
    drives: listing.drives,
    mountedVolumes,
    drivesQueriedAt: listing.queriedAt,
    drivesError: listing.error,
    mountedState: listing.error
      ? `Drive letters could not be queried: ${listing.error}`
      : `${mountedVolumes.length} VeraCrypt volume${mountedVolumes.length === 1 ? '' : 's'} mounted, read live from the VeraCrypt driver's device names.`
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

module.exports = { getStatus, binarySource, listDrives, mount, unmount, unmountAll, wipeCache, autoMountDevices, openNative, validateDriveLetter, validateVolume };
