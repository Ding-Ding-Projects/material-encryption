'use strict';

// Container engine. Creates, opens, re-keys and repairs VeraCrypt volumes using
// this application's own cryptography — no VeraCrypt process is involved in any
// operation here. Mounting a drive letter still belongs to the bundled VeraCrypt
// driver, because Windows only loads a signed kernel-mode filesystem driver.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const fmt = require('./volume-format.cjs');
const fat32 = require('./fat32.cjs');

const MIN_VOLUME_BYTES = 64 * 1024 * 1024;
const MAX_VOLUME_BYTES = 8 * 1024 ** 4;
const RANDOM_CHUNK = 4 * 1024 * 1024;

function assertVolumePath(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Choose a container file first.');
  if (input.includes('\0') || /[\r\n]/.test(input)) throw new Error('The container path contains unsupported characters.');
  return path.resolve(input);
}

function assertSize(bytes) {
  const value = Number(bytes);
  if (!Number.isSafeInteger(value) || value < MIN_VOLUME_BYTES || value > MAX_VOLUME_BYTES) {
    throw new Error(`Container size must be between ${MIN_VOLUME_BYTES / (1024 * 1024)} MB and 8 TB.`);
  }
  if (value % fmt.DEFAULT_SECTOR_SIZE !== 0) throw new Error('Container size must be a whole number of 512-byte sectors.');
  return value;
}

function dataAreaLength(volumeSize) {
  return volumeSize - fmt.DATA_AREA_OFFSET - fmt.BACKUP_AREA_SIZE;
}

// ---------------------------------------------------------------------------
// FAT32, written straight into the encrypted data area so a newly created
// container is usable the moment it is mounted rather than needing a separate
// format pass.
// ---------------------------------------------------------------------------

// FAT32 is only valid at 65525 clusters or more, so the cluster size follows the
// Windows size table and then steps down until enough clusters exist. A cluster
// size that is legal on a large volume produces an invalid filesystem on a small
// one, and Windows reports that as an unformatted disk rather than an error.
const FAT32_MIN_CLUSTERS = 65525;
const CLUSTER_SIZES = [64, 32, 16, 8, 4, 2, 1];

function fat32Layout(totalSectors, sectorsPerCluster) {
  const reservedSectors = 32;
  const numberOfFats = 2;
  let fatSectors = 1;
  let clusters = 0;
  for (let pass = 0; pass < 64; pass += 1) {
    const usable = totalSectors - reservedSectors - numberOfFats * fatSectors;
    clusters = Math.floor(usable / sectorsPerCluster);
    const needed = Math.max(1, Math.ceil(((clusters + 2) * 4) / fmt.DEFAULT_SECTOR_SIZE));
    if (needed === fatSectors) break;
    fatSectors = needed;
  }
  return { reservedSectors, numberOfFats, sectorsPerCluster, fatSectors, clusters };
}

function fat32Geometry(totalSectors) {
  const megabytes = (totalSectors * fmt.DEFAULT_SECTOR_SIZE) / (1024 * 1024);
  const preferred = megabytes > 32 * 1024 ? 64 : (megabytes > 16 * 1024 ? 32 : (megabytes > 8 * 1024 ? 16 : 8));
  for (const sectorsPerCluster of CLUSTER_SIZES.filter((size) => size <= preferred)) {
    const layout = fat32Layout(totalSectors, sectorsPerCluster);
    if (layout.clusters >= FAT32_MIN_CLUSTERS && layout.clusters < 0x0ffffff5) return layout;
  }
  throw new Error('The container is too small for a FAT32 filesystem. Use at least 64 MB.');
}

function fat32BootSector(totalSectors, geometry, volumeLabel, serial) {
  const sector = Buffer.alloc(fmt.DEFAULT_SECTOR_SIZE);
  sector.set([0xeb, 0x58, 0x90], 0);
  sector.write('MSWIN4.1', 3, 8, 'ascii');
  sector.writeUInt16LE(fmt.DEFAULT_SECTOR_SIZE, 11);
  sector.writeUInt8(geometry.sectorsPerCluster, 13);
  sector.writeUInt16LE(geometry.reservedSectors, 14);
  sector.writeUInt8(geometry.numberOfFats, 16);
  sector.writeUInt16LE(0, 17);           // root entries: 0 on FAT32
  sector.writeUInt16LE(0, 19);           // small sector count: 0 on FAT32
  sector.writeUInt8(0xf8, 21);           // fixed disk
  sector.writeUInt16LE(0, 22);           // FAT16 size: 0 on FAT32
  sector.writeUInt16LE(63, 24);          // sectors per track
  sector.writeUInt16LE(255, 26);         // heads
  sector.writeUInt32LE(0, 28);           // hidden sectors
  sector.writeUInt32LE(totalSectors, 32);
  sector.writeUInt32LE(geometry.fatSectors, 36);
  sector.writeUInt16LE(0, 40);           // flags: mirrored FATs
  sector.writeUInt16LE(0, 42);           // filesystem version
  sector.writeUInt32LE(2, 44);           // root directory cluster
  sector.writeUInt16LE(1, 48);           // FSInfo sector
  sector.writeUInt16LE(6, 50);           // backup boot sector
  sector.writeUInt8(0x80, 64);           // drive number
  sector.writeUInt8(0x29, 66);           // extended boot signature
  sector.writeUInt32LE(serial, 67);
  sector.write(volumeLabel.padEnd(11, ' ').slice(0, 11), 71, 11, 'ascii');
  sector.write('FAT32   ', 82, 8, 'ascii');
  sector.writeUInt16LE(0xaa55, 510);
  return sector;
}

function fat32InfoSector(freeClusters) {
  const sector = Buffer.alloc(fmt.DEFAULT_SECTOR_SIZE);
  sector.write('RRaA', 0, 'ascii');
  sector.write('rrAa', 484, 'ascii');
  sector.writeUInt32LE(freeClusters, 488);
  sector.writeUInt32LE(3, 492);          // next free cluster hint
  sector.writeUInt16LE(0xaa55, 510);
  return sector;
}

function fat32LabelEntry(volumeLabel) {
  const entry = Buffer.alloc(32);
  entry.write(volumeLabel.padEnd(11, ' ').slice(0, 11), 0, 11, 'ascii');
  entry.writeUInt8(0x08, 11);            // volume label attribute
  return entry;
}

// Yields [sectorIndex, buffer] pairs for every sector of a fresh FAT32
// filesystem that must not be random.
//
// The whole FAT area has to be written, not just its first sector: the data
// area is deliberately filled with random bytes, and any FAT sector left
// holding those bytes reads back as a table where every cluster is already
// allocated. The volume then reports itself full while appearing empty, which
// is exactly what it did before this covered the full span.
function* fat32Sectors(totalSectors, volumeLabel) {
  const geometry = fat32Geometry(totalSectors);
  const serial = crypto.randomBytes(4).readUInt32LE(0);
  const boot = fat32BootSector(totalSectors, geometry, volumeLabel, serial);
  const info = fat32InfoSector(geometry.clusters - 1);
  const blank = Buffer.alloc(fmt.DEFAULT_SECTOR_SIZE);

  for (let sector = 0; sector < geometry.reservedSectors; sector += 1) yield [sector, blank];
  yield [0, boot];
  yield [1, info];
  yield [6, boot];
  yield [7, info];

  const firstFatEntries = Buffer.alloc(fmt.DEFAULT_SECTOR_SIZE);
  firstFatEntries.writeUInt32LE(0x0ffffff8, 0);   // media descriptor
  firstFatEntries.writeUInt32LE(0x0fffffff, 4);   // end of chain
  firstFatEntries.writeUInt32LE(0x0fffffff, 8);   // root directory, one cluster
  for (let fat = 0; fat < geometry.numberOfFats; fat += 1) {
    const base = geometry.reservedSectors + fat * geometry.fatSectors;
    for (let sector = 0; sector < geometry.fatSectors; sector += 1) yield [base + sector, sector === 0 ? firstFatEntries : blank];
  }

  // The root directory's whole first cluster, so no random byte is mistaken for
  // a directory entry.
  const rootSector = geometry.reservedSectors + geometry.numberOfFats * geometry.fatSectors;
  const root = Buffer.alloc(fmt.DEFAULT_SECTOR_SIZE);
  fat32LabelEntry(volumeLabel).copy(root, 0);
  yield [rootSector, root];
  for (let sector = 1; sector < geometry.sectorsPerCluster; sector += 1) yield [rootSector + sector, blank];
}

// ---------------------------------------------------------------------------
// Volume operations
// ---------------------------------------------------------------------------

async function readHeaderAt(handle, offset) {
  const buffer = Buffer.alloc(fmt.HEADER_SIZE);
  const { bytesRead } = await handle.read(buffer, 0, fmt.HEADER_SIZE, offset);
  if (bytesRead !== fmt.HEADER_SIZE) throw new Error('The container is too small to hold a VeraCrypt header.');
  return buffer;
}

// Tries the supplied PRF first, then every other available one, exactly as
// VeraCrypt's own autodetection does.
function prfOrder(prf) {
  const available = Object.values(fmt.PRFS).filter((entry) => entry.available).map((entry) => entry.id);
  if (!prf || prf === 'Autodetection') return available;
  return [prf, ...available.filter((entry) => entry !== prf)];
}

// Same for the cipher: a container does not record which one it used in
// plaintext, so opening it means trying each until the two header CRCs agree.
function cipherOrder(cipher) {
  const available = Object.values(fmt.CIPHERS).filter((entry) => entry.available).map((entry) => entry.id);
  if (!cipher || cipher === 'Autodetection') return available;
  return [cipher, ...available.filter((entry) => entry !== cipher)];
}

async function openVolume({ volume, password, pim = 0, prf = 'Autodetection', cipher = 'Autodetection', useBackupHeader = false }) {
  const file = assertVolumePath(volume);
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('The selected container does not exist.');
  const handle = await fsp.open(file, 'r');
  try {
    const offset = useBackupHeader ? stat.size - fmt.BACKUP_AREA_SIZE : 0;
    if (offset < 0) throw new Error('The container has no backup header area.');
    const header = await readHeaderAt(handle, offset);
    for (const candidatePrf of prfOrder(prf)) {
      for (const candidateCipher of cipherOrder(cipher)) {
        const opened = fmt.tryDecryptHeader({ header, password, pim, prf: candidatePrf, cipherName: candidateCipher });
        if (opened) return { ...opened, path: file, fileSize: stat.size, usedBackupHeader: Boolean(useBackupHeader) };
      }
    }
    throw new Error('Incorrect password, PIM or key derivation function, or the container is not a VeraCrypt volume this build can open.');
  } finally {
    await handle.close();
  }
}

// Public metadata only: the master key never leaves the main process.
function describe(opened) {
  return {
    path: opened.path,
    fileSize: opened.fileSize,
    volumeSize: opened.volumeSize,
    dataSize: opened.encryptedAreaLength,
    cipher: opened.cipher,
    prf: opened.prf,
    pim: opened.pim,
    iterations: opened.iterations,
    sectorSize: opened.sectorSize,
    headerVersion: opened.headerVersion,
    hidden: opened.hiddenVolumeSize > 0,
    usedBackupHeader: opened.usedBackupHeader,
    flags: opened.flags
  };
}

async function verify({ volume, password, pim, prf, useBackupHeader }) {
  return describe(await openVolume({ volume, password, pim, prf, useBackupHeader }));
}

async function writeRandom(handle, offset, length, onProgress) {
  let written = 0;
  while (written < length) {
    const size = Math.min(RANDOM_CHUNK, length - written);
    const chunk = crypto.randomBytes(size);
    await handle.write(chunk, 0, size, offset + written);
    written += size;
    if (onProgress) onProgress(written, length);
  }
}

async function create({ volume, password, sizeBytes, cipher = 'AES', prf = 'HMAC-SHA-512', pim = 0, volumeLabel = 'ENCRYPTED', filesystem = 'FAT32', overwrite = false, onProgress = null }) {
  const file = assertVolumePath(volume);
  const size = assertSize(sizeBytes);
  const cipherSpec = fmt.resolveCipher(cipher);
  fmt.resolvePrf(prf);
  if (!overwrite && fs.existsSync(file)) throw new Error('A file already exists at that path. Confirm the overwrite first.');
  if (!['FAT32', 'None'].includes(filesystem)) throw new Error('This build formats new containers as FAT32, or leaves them unformatted.');

  const dataLength = dataAreaLength(size);
  if (dataLength <= 0) throw new Error('Container size must leave room for the header and backup header areas.');

  const masterKey = fmt.randomXtsKey(cipherSpec.keyBytes);
  const buildFor = (salt) => fmt.buildHeader({
    salt,
    headerKey: fmt.deriveHeaderKey({ password, salt, prf, pim, keyBytes: cipherSpec.keyBytes }),
    cipher: cipherSpec,
    masterKey,
    volumeSize: dataLength,
    encryptedAreaStart: fmt.DATA_AREA_OFFSET,
    encryptedAreaLength: dataLength
  });

  const handle = await fsp.open(file, 'w+');
  try {
    await handle.truncate(size);
    // Random fill first: an observer must not be able to tell used sectors from
    // unused ones, and a partially written container must never look valid.
    await writeRandom(handle, 0, fmt.DATA_AREA_OFFSET, null);
    await writeRandom(handle, fmt.DATA_AREA_OFFSET, dataLength, (done, total) => {
      if (onProgress) onProgress({ phase: 'random', done, total });
    });
    await writeRandom(handle, size - fmt.BACKUP_AREA_SIZE, fmt.BACKUP_AREA_SIZE, null);

    if (filesystem === 'FAT32') {
      const totalSectors = Math.floor(dataLength / fmt.DEFAULT_SECTOR_SIZE);
      for (const [sectorIndex, plaintext] of fat32Sectors(totalSectors, volumeLabel)) {
        const ciphertext = fmt.encryptDataUnit(cipherSpec.id, masterKey, sectorIndex, plaintext);
        await handle.write(ciphertext, 0, ciphertext.length, fmt.DATA_AREA_OFFSET + sectorIndex * fmt.DEFAULT_SECTOR_SIZE);
      }
      if (onProgress) onProgress({ phase: 'filesystem', done: 1, total: 1 });
    }

    const primary = buildFor(crypto.randomBytes(fmt.SALT_SIZE));
    const backup = buildFor(crypto.randomBytes(fmt.SALT_SIZE));
    await handle.write(primary, 0, primary.length, 0);
    await handle.write(backup, 0, backup.length, size - fmt.BACKUP_AREA_SIZE);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(file, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  masterKey.fill(0);
  if (onProgress) onProgress({ phase: 'done', done: 1, total: 1 });
  return { path: file, sizeBytes: size, dataSize: dataLength, cipher: cipherSpec.id, prf, pim, filesystem };
}

// Re-keys both headers with a new password. The master key is preserved, so the
// data area is untouched and the operation cannot corrupt stored files.
async function changePassword({ volume, currentPassword, currentPim = 0, currentPrf = 'Autodetection', newPassword, newPim = 0, newPrf = 'HMAC-SHA-512' }) {
  const opened = await openVolume({ volume, password: currentPassword, pim: currentPim, prf: currentPrf });
  const cipherSpec = fmt.resolveCipher(opened.cipher);
  fmt.resolvePrf(newPrf);
  if (!String(newPassword || '')) throw new Error('Enter the new volume password.');

  const rebuild = (salt) => fmt.buildHeader({
    salt,
    headerKey: fmt.deriveHeaderKey({ password: newPassword, salt, prf: newPrf, pim: newPim, keyBytes: cipherSpec.keyBytes }),
    cipher: cipherSpec,
    masterKey: opened.masterKey,
    volumeSize: opened.volumeSize,
    encryptedAreaStart: opened.encryptedAreaStart,
    encryptedAreaLength: opened.encryptedAreaLength,
    hiddenVolumeSize: opened.hiddenVolumeSize,
    flags: opened.flags,
    sectorSize: opened.sectorSize
  });

  const handle = await fsp.open(opened.path, 'r+');
  try {
    const primary = rebuild(crypto.randomBytes(fmt.SALT_SIZE));
    await handle.write(primary, 0, primary.length, 0);
    await handle.sync();
    const backupOffset = opened.fileSize - fmt.BACKUP_AREA_SIZE;
    if (backupOffset > fmt.DATA_AREA_OFFSET) {
      const backup = rebuild(crypto.randomBytes(fmt.SALT_SIZE));
      await handle.write(backup, 0, backup.length, backupOffset);
      await handle.sync();
    }
  } finally {
    await handle.close();
    opened.masterKey.fill(0);
  }
  return { path: opened.path, prf: newPrf, pim: Number(newPim) || 0 };
}

async function backupHeader({ volume, password, pim, prf, destination }) {
  const opened = await openVolume({ volume, password, pim, prf });
  opened.masterKey.fill(0);
  const target = assertVolumePath(destination);
  const handle = await fsp.open(opened.path, 'r');
  try {
    const buffer = Buffer.alloc(fmt.BACKUP_AREA_SIZE);
    await handle.read(buffer, 0, fmt.HEADER_SIZE, 0);
    const backupRegion = Buffer.alloc(fmt.HEADER_SIZE);
    await handle.read(backupRegion, 0, fmt.HEADER_SIZE, opened.fileSize - fmt.BACKUP_AREA_SIZE);
    backupRegion.copy(buffer, fmt.HEADER_AREA_SIZE);
    await fsp.writeFile(target, buffer);
  } finally {
    await handle.close();
  }
  return { path: target, bytes: fmt.BACKUP_AREA_SIZE };
}

// Restores the primary header from the volume's own backup header, which is the
// recovery path when the first 512 bytes are damaged.
async function restoreHeader({ volume, password, pim, prf }) {
  const opened = await openVolume({ volume, password, pim, prf, useBackupHeader: true });
  opened.masterKey.fill(0);
  const handle = await fsp.open(opened.path, 'r+');
  try {
    const backup = await readHeaderAt(handle, opened.fileSize - fmt.BACKUP_AREA_SIZE);
    await handle.write(backup, 0, backup.length, 0);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { path: opened.path, restoredFrom: 'backup header' };
}

// Reads plaintext sectors out of the data area without mounting anything. This
// is what lets the app inspect a container the driver has not touched.
async function readSectors({ volume, password, pim, prf, sectorIndex = 0, sectorCount = 1 }) {
  if (!Number.isSafeInteger(sectorIndex) || sectorIndex < 0) throw new Error('Sector index must be a whole number of 0 or more.');
  if (!Number.isSafeInteger(sectorCount) || sectorCount < 1 || sectorCount > 2048) throw new Error('Read between 1 and 2048 sectors at a time.');
  const opened = await openVolume({ volume, password, pim, prf });
  const handle = await fsp.open(opened.path, 'r');
  try {
    const out = Buffer.alloc(sectorCount * opened.sectorSize);
    for (let index = 0; index < sectorCount; index += 1) {
      const unit = sectorIndex + index;
      const offset = opened.encryptedAreaStart + unit * opened.sectorSize;
      if (offset + opened.sectorSize > opened.encryptedAreaStart + opened.encryptedAreaLength) throw new Error('That sector is past the end of the encrypted area.');
      const ciphertext = Buffer.alloc(opened.sectorSize);
      await handle.read(ciphertext, 0, opened.sectorSize, offset);
      fmt.decryptDataUnit(opened.cipher, opened.masterKey, unit, ciphertext).copy(out, index * opened.sectorSize);
    }
    return out;
  } finally {
    await handle.close();
    opened.masterKey.fill(0);
  }
}

// Opens the container and hands FAT32 a sector device that decrypts on read and
// re-encrypts on write, so the filesystem code never sees ciphertext and the
// master key never leaves this function. This is what makes a container usable
// without a drive letter: no driver, no mounting, no external program.
async function withFilesystem({ volume, password, pim, prf, writable = false }, callback) {
  const opened = await openVolume({ volume, password, pim, prf });
  const handle = await fsp.open(opened.path, writable ? 'r+' : 'r');
  const sectorSize = opened.sectorSize;
  const limit = opened.encryptedAreaStart + opened.encryptedAreaLength;

  const device = {
    sectorSize,
    read(sectorIndex, count) {
      const out = Buffer.alloc(count * sectorSize);
      for (let index = 0; index < count; index += 1) {
        const unit = sectorIndex + index;
        const offset = opened.encryptedAreaStart + unit * sectorSize;
        if (offset + sectorSize > limit) throw new Error('A read went past the end of the encrypted area.');
        const ciphertext = Buffer.alloc(sectorSize);
        fs.readSync(handle.fd, ciphertext, 0, sectorSize, offset);
        fmt.decryptDataUnit(opened.cipher, opened.masterKey, unit, ciphertext).copy(out, index * sectorSize);
      }
      return out;
    },
    write(sectorIndex, data) {
      if (!writable) throw new Error('This container was opened read-only.');
      if (data.length % sectorSize !== 0) throw new Error('A write must be a whole number of sectors.');
      for (let index = 0; index < data.length / sectorSize; index += 1) {
        const unit = sectorIndex + index;
        const offset = opened.encryptedAreaStart + unit * sectorSize;
        if (offset + sectorSize > limit) throw new Error('A write went past the end of the encrypted area.');
        const plaintext = data.subarray(index * sectorSize, (index + 1) * sectorSize);
        const ciphertext = fmt.encryptDataUnit(opened.cipher, opened.masterKey, unit, plaintext);
        fs.writeSync(handle.fd, ciphertext, 0, sectorSize, offset);
      }
    }
  };

  try {
    return await callback(fat32.createVolume(device), opened);
  } finally {
    if (writable) await handle.sync().catch(() => {});
    await handle.close();
    opened.masterKey.fill(0);
  }
}

const listFiles = ({ volume, password, pim, prf, path: inner = '/' }) =>
  withFilesystem({ volume, password, pim, prf }, (filesystem) => ({ entries: filesystem.list(inner), usage: filesystem.usage(), path: inner }));

const readFile = ({ volume, password, pim, prf, path: inner }) =>
  withFilesystem({ volume, password, pim, prf }, (filesystem) => filesystem.readFile(inner));

const writeFile = ({ volume, password, pim, prf, path: inner, contents }) =>
  withFilesystem({ volume, password, pim, prf, writable: true }, (filesystem) => filesystem.writeFile(inner, contents));

const deleteFile = ({ volume, password, pim, prf, path: inner }) =>
  withFilesystem({ volume, password, pim, prf, writable: true }, (filesystem) => filesystem.deleteFile(inner));

const makeDirectory = ({ volume, password, pim, prf, path: inner }) =>
  withFilesystem({ volume, password, pim, prf, writable: true }, (filesystem) => filesystem.makeDirectory(inner));

module.exports = {
  MIN_VOLUME_BYTES, MAX_VOLUME_BYTES,
  withFilesystem, listFiles, readFile, writeFile, deleteFile, makeDirectory,
  create, verify, describe, changePassword, backupHeader, restoreHeader, readSectors,
  availableCiphers: fmt.availableCiphers, availablePrfs: fmt.availablePrfs,
  fat32Geometry, dataAreaLength, assertSize, assertVolumePath
};
