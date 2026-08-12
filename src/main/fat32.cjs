'use strict';

// A FAT32 implementation that reads and writes through an arbitrary sector
// device. Pointed at the decrypted data area of a container, it lets the app
// browse and change the files inside without a drive letter, a kernel driver,
// or any external program.
//
// A `device` is { sectorSize, read(sectorIndex, count) -> Buffer,
// write(sectorIndex, buffer) -> void }. The volume engine supplies one backed
// by XTS, so every sector is decrypted on read and re-encrypted on write.

const ATTR_READ_ONLY = 0x01;
const ATTR_HIDDEN = 0x02;
const ATTR_SYSTEM = 0x04;
const ATTR_VOLUME_ID = 0x08;
const ATTR_DIRECTORY = 0x10;
const ATTR_LONG_NAME = 0x0f;
const ENTRY_SIZE = 32;
const FREE_ENTRY = 0xe5;
const END_OF_CHAIN = 0x0ffffff8;
const MAX_CLUSTER = 0x0ffffff6;

function readBootSector(device) {
  const sector = device.read(0, 1);
  if (sector.readUInt16LE(510) !== 0xaa55) throw new Error('This container does not hold a recognised FAT filesystem.');
  const bytesPerSector = sector.readUInt16LE(11);
  const sectorsPerCluster = sector.readUInt8(13);
  const reservedSectors = sector.readUInt16LE(14);
  const numberOfFats = sector.readUInt8(16);
  const fatSectors = sector.readUInt32LE(36);
  const rootCluster = sector.readUInt32LE(44);
  const totalSectors = sector.readUInt32LE(32);
  if (!bytesPerSector || !sectorsPerCluster || !numberOfFats || !fatSectors) throw new Error('The FAT32 boot sector is malformed.');
  if (sector.readUInt16LE(17) !== 0 || sector.readUInt16LE(22) !== 0) throw new Error('This is a FAT12 or FAT16 volume; only FAT32 is supported.');
  const firstDataSector = reservedSectors + numberOfFats * fatSectors;
  return {
    bytesPerSector,
    sectorsPerCluster,
    reservedSectors,
    numberOfFats,
    fatSectors,
    rootCluster,
    totalSectors,
    firstDataSector,
    clusterCount: Math.floor((totalSectors - firstDataSector) / sectorsPerCluster),
    bytesPerCluster: bytesPerSector * sectorsPerCluster,
    label: sector.subarray(71, 82).toString('ascii').trim()
  };
}

function createVolume(device) {
  const bpb = readBootSector(device);
  const firstSectorOfCluster = (cluster) => bpb.firstDataSector + (cluster - 2) * bpb.sectorsPerCluster;

  function readFatEntry(cluster) {
    const offset = cluster * 4;
    const sectorIndex = bpb.reservedSectors + Math.floor(offset / bpb.bytesPerSector);
    const sector = device.read(sectorIndex, 1);
    return sector.readUInt32LE(offset % bpb.bytesPerSector) & 0x0fffffff;
  }

  function writeFatEntry(cluster, value) {
    const offset = cluster * 4;
    // Every FAT copy is updated, or chkdsk reports the mirrors as inconsistent.
    for (let copy = 0; copy < bpb.numberOfFats; copy += 1) {
      const sectorIndex = bpb.reservedSectors + copy * bpb.fatSectors + Math.floor(offset / bpb.bytesPerSector);
      const sector = device.read(sectorIndex, 1);
      const existing = sector.readUInt32LE(offset % bpb.bytesPerSector);
      sector.writeUInt32LE((existing & 0xf0000000) | (value & 0x0fffffff), offset % bpb.bytesPerSector);
      device.write(sectorIndex, sector);
    }
  }

  function chainOf(startCluster) {
    const chain = [];
    let cluster = startCluster;
    while (cluster >= 2 && cluster < MAX_CLUSTER) {
      if (chain.includes(cluster)) throw new Error('The cluster chain loops; the filesystem is damaged.');
      chain.push(cluster);
      cluster = readFatEntry(cluster);
    }
    return chain;
  }

  // Where the last search stopped. Without it, allocating the nth cluster of a
  // file rescans the whole FAT from cluster 2, so writing a large file costs
  // O(clusters²) decryptions.
  let searchCursor = 2;

  function findFreeCluster() {
    const entriesPerSector = bpb.bytesPerSector / 4;
    const lastCluster = bpb.clusterCount + 1;
    for (let pass = 0; pass < 2; pass += 1) {
      const start = pass === 0 ? searchCursor : 2;
      const stop = pass === 0 ? lastCluster : searchCursor;
      for (let sector = Math.floor(start / entriesPerSector); sector < bpb.fatSectors; sector += 1) {
        const base = sector * entriesPerSector;
        if (base > stop) break;
        const data = device.read(bpb.reservedSectors + sector, 1);
        for (let slot = 0; slot < entriesPerSector; slot += 1) {
          const cluster = base + slot;
          if (cluster < Math.max(2, start) || cluster > stop) continue;
          if ((data.readUInt32LE(slot * 4) & 0x0fffffff) === 0) { searchCursor = cluster + 1; return cluster; }
        }
      }
    }
    return 0;
  }

  function allocateCluster(previous = null) {
    const cluster = findFreeCluster();
    if (!cluster) throw new Error('The container is full.');
    writeFatEntry(cluster, END_OF_CHAIN);
    if (previous !== null) writeFatEntry(previous, cluster);
    // A newly allocated cluster still holds the random bytes the container was
    // filled with, which would read back as garbage directory entries.
    device.write(firstSectorOfCluster(cluster), Buffer.alloc(bpb.bytesPerCluster));
    return cluster;
  }

  function freeChain(startCluster) {
    for (const cluster of chainOf(startCluster)) writeFatEntry(cluster, 0);
  }

  const readCluster = (cluster) => device.read(firstSectorOfCluster(cluster), bpb.sectorsPerCluster);
  const writeCluster = (cluster, data) => device.write(firstSectorOfCluster(cluster), data);

  function readChain(startCluster) {
    const chain = chainOf(startCluster);
    return chain.length ? Buffer.concat(chain.map(readCluster)) : Buffer.alloc(0);
  }

  // ---- directory entries -------------------------------------------------

  const LFN_OFFSETS = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];

  function longNamePart(entry) {
    let text = '';
    for (const offset of LFN_OFFSETS) {
      const unit = entry.readUInt16LE(offset);
      if (unit === 0 || unit === 0xffff) break;
      text += String.fromCharCode(unit);
    }
    return text;
  }

  function shortName(entry) {
    const base = entry.subarray(0, 8).toString('latin1').trimEnd();
    const extension = entry.subarray(8, 11).toString('latin1').trimEnd();
    return extension ? `${base}.${extension}` : base;
  }

  function parseDirectory(startCluster) {
    const data = readChain(startCluster);
    const entries = [];
    let longName = '';
    for (let offset = 0; offset + ENTRY_SIZE <= data.length; offset += ENTRY_SIZE) {
      const entry = data.subarray(offset, offset + ENTRY_SIZE);
      const first = entry[0];
      if (first === 0x00) break;
      if (first === FREE_ENTRY) { longName = ''; continue; }
      const attributes = entry.readUInt8(11);
      if ((attributes & ATTR_LONG_NAME) === ATTR_LONG_NAME) {
        // Long-name entries precede their short entry in reverse order.
        longName = longNamePart(entry) + longName;
        continue;
      }
      if (attributes & ATTR_VOLUME_ID) { longName = ''; continue; }
      const cluster = (entry.readUInt16LE(20) << 16) | entry.readUInt16LE(26);
      entries.push({
        name: longName || shortName(entry),
        shortName: shortName(entry),
        directory: Boolean(attributes & ATTR_DIRECTORY),
        readOnly: Boolean(attributes & ATTR_READ_ONLY),
        hidden: Boolean(attributes & ATTR_HIDDEN),
        system: Boolean(attributes & ATTR_SYSTEM),
        size: entry.readUInt32LE(28),
        cluster,
        offset
      });
      longName = '';
    }
    return entries;
  }

  function checksumOfShortName(name11) {
    let sum = 0;
    for (let index = 0; index < 11; index += 1) sum = (((sum & 1) << 7) + (sum >> 1) + name11[index]) & 0xff;
    return sum;
  }

  // FAT32 still requires a conforming 8.3 entry beside every long name, and a
  // colliding one silently shadows an existing file, so the tail is numbered.
  function buildShortName(longName, taken) {
    const cleaned = longName.toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
    const dot = cleaned.lastIndexOf('.');
    const rawBase = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/\./g, '_') || 'FILE';
    const extension = (dot > 0 ? cleaned.slice(dot + 1) : '').slice(0, 3);
    for (let index = 1; index < 1000; index += 1) {
      const suffix = `~${index}`;
      const base = (rawBase.slice(0, Math.max(1, 8 - suffix.length)) + suffix).slice(0, 8);
      const candidate = Buffer.alloc(11, 0x20);
      candidate.write(base.padEnd(8, ' '), 0, 8, 'latin1');
      candidate.write(extension.padEnd(3, ' '), 8, 3, 'latin1');
      if (!taken.has(candidate.toString('latin1'))) return candidate;
    }
    throw new Error('Could not derive a unique 8.3 name for that file.');
  }

  function encodeEntries(longName, short11, { cluster, size, directory }) {
    const units = [];
    for (const character of longName) units.push(character.charCodeAt(0));
    const chunks = Math.ceil(units.length / 13) || 1;
    const checksum = checksumOfShortName(short11);
    const buffers = [];
    for (let index = chunks; index >= 1; index -= 1) {
      const entry = Buffer.alloc(ENTRY_SIZE, 0xff);
      entry.writeUInt8(index === chunks ? (0x40 | index) : index, 0);
      entry.writeUInt8(ATTR_LONG_NAME, 11);
      entry.writeUInt8(0, 12);
      entry.writeUInt8(checksum, 13);
      entry.writeUInt16LE(0, 26);
      for (let slot = 0; slot < 13; slot += 1) {
        const unit = units[(index - 1) * 13 + slot];
        entry.writeUInt16LE(unit === undefined ? (slot === units.length % 13 && index === chunks ? 0 : 0xffff) : unit, LFN_OFFSETS[slot]);
      }
      // A name that exactly fills a chunk needs no terminator; otherwise the
      // slot after the last character is 0 and the rest are 0xffff.
      const used = units.length - (index - 1) * 13;
      if (used >= 0 && used < 13) entry.writeUInt16LE(0, LFN_OFFSETS[used]);
      buffers.push(entry);
    }
    const main = Buffer.alloc(ENTRY_SIZE);
    short11.copy(main, 0);
    main.writeUInt8(directory ? ATTR_DIRECTORY : 0, 11);
    main.writeUInt16LE((cluster >>> 16) & 0xffff, 20);
    main.writeUInt16LE(cluster & 0xffff, 26);
    main.writeUInt32LE(directory ? 0 : size, 28);
    buffers.push(main);
    return Buffer.concat(buffers);
  }

  // Writes `payload` into the directory, extending it by a cluster when the
  // existing clusters have no run of free slots long enough.
  function appendToDirectory(directoryCluster, payload) {
    const needed = payload.length / ENTRY_SIZE;
    let chain = chainOf(directoryCluster);
    let data = Buffer.concat(chain.map(readCluster));

    const findRun = (buffer) => {
      let run = 0;
      for (let offset = 0; offset + ENTRY_SIZE <= buffer.length; offset += ENTRY_SIZE) {
        const first = buffer[offset];
        run = (first === 0x00 || first === FREE_ENTRY) ? run + 1 : 0;
        if (run === needed) return offset - (needed - 1) * ENTRY_SIZE;
      }
      return -1;
    };

    let start = findRun(data);
    // Growing the directory has to keep it contiguous. Writing the new entries
    // at the start of a fresh cluster leaves the old cluster's trailing 0x00 in
    // place, and 0x00 terminates a directory — so every entry in the new
    // cluster becomes invisible, which is precisely how files went missing here.
    while (start < 0) {
      const added = allocateCluster(chain[chain.length - 1]);
      chain = chain.concat(added);
      data = Buffer.concat([data, Buffer.alloc(bpb.bytesPerCluster)]);
      start = findRun(data);
    }

    payload.copy(data, start);
    chain.forEach((cluster, index) => writeCluster(cluster, data.subarray(index * bpb.bytesPerCluster, (index + 1) * bpb.bytesPerCluster)));
  }

  function markEntryDeleted(directoryCluster, entryOffset) {
    const chain = chainOf(directoryCluster);
    const data = Buffer.concat(chain.map(readCluster));
    // Clear the long-name entries in front of it too, or their orphans remain.
    let offset = entryOffset - ENTRY_SIZE;
    while (offset >= 0 && (data.readUInt8(offset + 11) & ATTR_LONG_NAME) === ATTR_LONG_NAME) {
      data.writeUInt8(FREE_ENTRY, offset);
      offset -= ENTRY_SIZE;
    }
    data.writeUInt8(FREE_ENTRY, entryOffset);
    chain.forEach((cluster, index) => writeCluster(cluster, data.subarray(index * bpb.bytesPerCluster, (index + 1) * bpb.bytesPerCluster)));
  }

  // ---- path resolution ---------------------------------------------------

  function splitPath(inputPath) {
    return String(inputPath || '/').split(/[\\/]+/).filter(Boolean);
  }

  function resolveDirectory(inputPath) {
    let cluster = bpb.rootCluster;
    for (const part of splitPath(inputPath)) {
      const match = parseDirectory(cluster).find((entry) => entry.directory && entry.name.toLowerCase() === part.toLowerCase());
      if (!match) throw new Error(`There is no folder named "${part}" in the container.`);
      cluster = match.cluster;
    }
    return cluster;
  }

  function resolveFile(inputPath) {
    const parts = splitPath(inputPath);
    if (!parts.length) throw new Error('Name a file inside the container.');
    const name = parts.pop();
    const directoryCluster = resolveDirectory(parts.join('/'));
    const match = parseDirectory(directoryCluster).find((entry) => !entry.directory && entry.name.toLowerCase() === name.toLowerCase());
    if (!match) throw new Error(`There is no file named "${name}" in the container.`);
    return { directoryCluster, entry: match };
  }

  // ---- public surface ----------------------------------------------------

  function list(inputPath = '/') {
    return parseDirectory(resolveDirectory(inputPath))
      .filter((entry) => entry.name !== '.' && entry.name !== '..')
      .map(({ name, directory, size, readOnly, hidden, system }) => ({ name, directory, size, readOnly, hidden, system }));
  }

  function readFile(inputPath) {
    const { entry } = resolveFile(inputPath);
    if (!entry.cluster) return Buffer.alloc(0);
    return readChain(entry.cluster).subarray(0, entry.size);
  }

  function writeFile(inputPath, contents) {
    if (!Buffer.isBuffer(contents)) throw new Error('File contents must be a buffer.');
    const parts = splitPath(inputPath);
    if (!parts.length) throw new Error('Name a file inside the container.');
    const name = parts.pop();
    if (name.length > 255) throw new Error('A FAT32 file name is at most 255 characters.');
    const directoryCluster = resolveDirectory(parts.join('/'));

    const existing = parseDirectory(directoryCluster).find((entry) => !entry.directory && entry.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.cluster) freeChain(existing.cluster);
      markEntryDeleted(directoryCluster, existing.offset);
    }

    let first = 0;
    if (contents.length) {
      const clustersNeeded = Math.ceil(contents.length / bpb.bytesPerCluster);
      let previous = null;
      for (let index = 0; index < clustersNeeded; index += 1) {
        const cluster = allocateCluster(previous);
        if (index === 0) first = cluster;
        const block = Buffer.alloc(bpb.bytesPerCluster);
        contents.copy(block, 0, index * bpb.bytesPerCluster, Math.min(contents.length, (index + 1) * bpb.bytesPerCluster));
        writeCluster(cluster, block);
        previous = cluster;
      }
    }

    const taken = new Set(parseDirectory(directoryCluster).map((entry) => entry.shortName));
    const short11 = buildShortName(name, taken);
    appendToDirectory(directoryCluster, encodeEntries(name, short11, { cluster: first, size: contents.length, directory: false }));
    return { path: inputPath, size: contents.length };
  }

  function deleteFile(inputPath) {
    const { directoryCluster, entry } = resolveFile(inputPath);
    if (entry.cluster) freeChain(entry.cluster);
    markEntryDeleted(directoryCluster, entry.offset);
    return { path: inputPath };
  }

  function makeDirectory(inputPath) {
    const parts = splitPath(inputPath);
    if (!parts.length) throw new Error('Name the folder to create.');
    const name = parts.pop();
    const parentCluster = resolveDirectory(parts.join('/'));
    if (parseDirectory(parentCluster).some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" already exists in the container.`);
    }
    const cluster = allocateCluster(null);

    // A subdirectory must open with its own "." and ".." entries, and ".."
    // points at 0 when the parent is the root.
    const block = Buffer.alloc(bpb.bytesPerCluster);
    const dot = Buffer.alloc(ENTRY_SIZE);
    dot.write('.          ', 0, 11, 'latin1');
    dot.writeUInt8(ATTR_DIRECTORY, 11);
    dot.writeUInt16LE((cluster >>> 16) & 0xffff, 20);
    dot.writeUInt16LE(cluster & 0xffff, 26);
    dot.copy(block, 0);
    const dotdot = Buffer.alloc(ENTRY_SIZE);
    dotdot.write('..         ', 0, 11, 'latin1');
    dotdot.writeUInt8(ATTR_DIRECTORY, 11);
    const parentValue = parentCluster === bpb.rootCluster ? 0 : parentCluster;
    dotdot.writeUInt16LE((parentValue >>> 16) & 0xffff, 20);
    dotdot.writeUInt16LE(parentValue & 0xffff, 26);
    dotdot.copy(block, ENTRY_SIZE);
    writeCluster(cluster, block);

    const taken = new Set(parseDirectory(parentCluster).map((entry) => entry.shortName));
    appendToDirectory(parentCluster, encodeEntries(name, buildShortName(name, taken), { cluster, size: 0, directory: true }));
    return { path: inputPath };
  }

  // Counts free clusters by sweeping the FAT a sector at a time. Asking
  // readFatEntry per cluster would decrypt the same sector 128 times over and
  // turn a status line into a nine-minute operation.
  function usage() {
    let free = 0;
    const entriesPerSector = bpb.bytesPerSector / 4;
    const lastCluster = bpb.clusterCount + 1;
    for (let sector = 0; sector < bpb.fatSectors; sector += 1) {
      const first = sector * entriesPerSector;
      if (first > lastCluster) break;
      const data = device.read(bpb.reservedSectors + sector, 1);
      for (let slot = 0; slot < entriesPerSector; slot += 1) {
        const cluster = first + slot;
        if (cluster < 2 || cluster > lastCluster) continue;
        if ((data.readUInt32LE(slot * 4) & 0x0fffffff) === 0) free += 1;
      }
    }
    return {
      label: bpb.label,
      bytesPerCluster: bpb.bytesPerCluster,
      totalBytes: bpb.clusterCount * bpb.bytesPerCluster,
      freeBytes: free * bpb.bytesPerCluster,
      usedBytes: (bpb.clusterCount - free) * bpb.bytesPerCluster
    };
  }

  return { bpb, list, readFile, writeFile, deleteFile, makeDirectory, usage };
}

module.exports = { createVolume, readBootSector };
