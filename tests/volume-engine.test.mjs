import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../src/main/volume-engine.cjs');
const fmt = require('../src/main/volume-format.cjs');

const SIZE = 64 * 1024 * 1024;
// A low PIM keeps the derivation honest but fast enough to run in a test suite;
// the production default of 0 means 500,000 iterations.
const PIM = 1;

async function scratch(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-'));
  return { dir, file: path.join(dir, name), cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('crc32 matches the published check value', () => {
  assert.equal(fmt.crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
});

test('iteration counts follow the non-system and PIM rules', () => {
  assert.equal(fmt.iterationCount(0), 500000);
  assert.equal(fmt.iterationCount(1), 16000);
  assert.equal(fmt.iterationCount(485), 500000);
  assert.throws(() => fmt.iterationCount(-1), /PIM/);
});

test('a header round-trips and rejects the wrong password', () => {
  const salt = Buffer.alloc(fmt.SALT_SIZE, 9);
  const cipher = fmt.resolveCipher('AES');
  const masterKey = fmt.randomXtsKey(cipher.keyBytes);
  const headerKey = fmt.deriveHeaderKey({ password: 'correct horse', salt, prf: 'HMAC-SHA-512', pim: PIM, keyBytes: cipher.keyBytes });
  const header = fmt.buildHeader({ salt, headerKey, cipher, masterKey, volumeSize: 1024, encryptedAreaStart: fmt.DATA_AREA_OFFSET, encryptedAreaLength: 1024 });

  const opened = fmt.tryDecryptHeader({ header, password: 'correct horse', pim: PIM });
  assert.ok(opened, 'the correct password must open the header');
  assert.equal(opened.encryptedAreaLength, 1024);
  assert.ok(opened.masterKey.equals(masterKey), 'the master key must survive the round trip');

  assert.equal(fmt.tryDecryptHeader({ header, password: 'wrong horse', pim: PIM }), null);
  assert.equal(fmt.tryDecryptHeader({ header, password: 'correct horse', pim: PIM + 1 }), null);
});

test('XTS refuses to generate a key whose halves match', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = fmt.randomXtsKey(64);
    assert.ok(!key.subarray(0, 32).equals(key.subarray(32)));
  }
});

test('a created container opens, reports real geometry and carries a mountable FAT32 filesystem', async () => {
  const { file, cleanup } = await scratch('volume.hc');
  try {
    const created = await engine.create({ volume: file, password: 'a strong passphrase', sizeBytes: SIZE, pim: PIM, volumeLabel: 'MATERIAL' });
    assert.equal(created.sizeBytes, SIZE);
    assert.equal((await fs.stat(file)).size, SIZE);

    const info = await engine.verify({ volume: file, password: 'a strong passphrase', pim: PIM });
    assert.equal(info.cipher, 'AES');
    assert.equal(info.prf, 'HMAC-SHA-512');
    assert.equal(info.sectorSize, 512);
    assert.equal(info.dataSize, engine.dataAreaLength(SIZE));
    assert.equal(info.hidden, false);

    await assert.rejects(engine.verify({ volume: file, password: 'not the passphrase', pim: PIM }), /Incorrect password/);

    const boot = await engine.readSectors({ volume: file, password: 'a strong passphrase', pim: PIM, sectorIndex: 0, sectorCount: 1 });
    assert.equal(boot.readUInt16LE(510), 0xaa55, 'boot sector signature');
    assert.equal(boot.subarray(82, 90).toString('ascii'), 'FAT32   ');
    assert.equal(boot.subarray(71, 82).toString('ascii').trim(), 'MATERIAL');
    assert.equal(boot.readUInt32LE(32), engine.dataAreaLength(SIZE) / 512, 'total sector count');
    assert.equal(boot.readUInt32LE(44), 2, 'root directory cluster');
  } finally {
    await cleanup();
  }
});

test('the backup header opens the volume independently of the primary header', async () => {
  const { file, cleanup } = await scratch('backup.hc');
  try {
    await engine.create({ volume: file, password: 'passphrase one', sizeBytes: SIZE, pim: PIM });
    const backup = await engine.verify({ volume: file, password: 'passphrase one', pim: PIM, useBackupHeader: true });
    assert.equal(backup.usedBackupHeader, true);
    assert.equal(backup.dataSize, engine.dataAreaLength(SIZE));

    // Destroy the primary header, then recover from the backup.
    const handle = await fs.open(file, 'r+');
    await handle.write(Buffer.alloc(fmt.HEADER_SIZE), 0, fmt.HEADER_SIZE, 0);
    await handle.close();
    await assert.rejects(engine.verify({ volume: file, password: 'passphrase one', pim: PIM }), /Incorrect password/);

    await engine.restoreHeader({ volume: file, password: 'passphrase one', pim: PIM });
    const recovered = await engine.verify({ volume: file, password: 'passphrase one', pim: PIM });
    assert.equal(recovered.dataSize, engine.dataAreaLength(SIZE));
  } finally {
    await cleanup();
  }
});

test('changing the password preserves the data area', async () => {
  const { file, cleanup } = await scratch('rekey.hc');
  try {
    await engine.create({ volume: file, password: 'first passphrase', sizeBytes: SIZE, pim: PIM, volumeLabel: 'REKEY' });
    const before = await engine.readSectors({ volume: file, password: 'first passphrase', pim: PIM, sectorIndex: 0, sectorCount: 1 });

    await engine.changePassword({ volume: file, currentPassword: 'first passphrase', currentPim: PIM, newPassword: 'second passphrase', newPim: PIM });
    await assert.rejects(engine.verify({ volume: file, password: 'first passphrase', pim: PIM }), /Incorrect password/);

    const after = await engine.readSectors({ volume: file, password: 'second passphrase', pim: PIM, sectorIndex: 0, sectorCount: 1 });
    assert.ok(before.equals(after), 'the plaintext data area must be identical after a re-key');

    // The backup header must be re-keyed too, or the old password would still work.
    const backup = await engine.verify({ volume: file, password: 'second passphrase', pim: PIM, useBackupHeader: true });
    assert.equal(backup.usedBackupHeader, true);
  } finally {
    await cleanup();
  }
});

test('ported ciphers are offered and unported ones are reported rather than silently substituted', () => {
  const ciphers = engine.availableCiphers();
  const byId = Object.fromEntries(ciphers.map((entry) => [entry.id, entry]));
  assert.equal(byId.AES.available, true);
  assert.equal(byId.Serpent.available, true, 'Serpent is ported and must be offered');
  assert.equal(byId.Twofish.available, true, 'Twofish is ported and must be offered');
  assert.equal(byId.Camellia.available, false);
  assert.match(byId.Camellia.reason, /not been ported/);
  assert.throws(() => fmt.resolveCipher('Camellia'), /not been ported/);
  assert.throws(() => fmt.resolvePrf('HMAC-Streebog'), /HMAC-SHA-512/);
});

test('a Serpent container round-trips through create, open and read', async () => {
  const { file, cleanup } = await scratch('serpent.hc');
  try {
    await engine.create({ volume: file, password: 'serpent passphrase', sizeBytes: SIZE, pim: PIM, cipher: 'Serpent', volumeLabel: 'SERPENT' });
    // Opened without naming the cipher: autodetection has to find it.
    const info = await engine.verify({ volume: file, password: 'serpent passphrase', pim: PIM });
    assert.equal(info.cipher, 'Serpent');
    const boot = await engine.readSectors({ volume: file, password: 'serpent passphrase', pim: PIM, sectorIndex: 0, sectorCount: 1 });
    assert.equal(boot.readUInt16LE(510), 0xaa55);
    assert.equal(boot.subarray(71, 82).toString('ascii').trim(), 'SERPENT');
  } finally {
    await cleanup();
  }
});

test('container sizes outside the supported range are refused', () => {
  assert.throws(() => engine.assertSize(1024), /between/);
  assert.throws(() => engine.assertSize(SIZE + 1), /whole number of 512-byte sectors/);
  assert.equal(engine.assertSize(SIZE), SIZE);
});
