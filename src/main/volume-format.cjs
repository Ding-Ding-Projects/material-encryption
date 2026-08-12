'use strict';

// VeraCrypt volume header format, implemented from the published on-disk
// specification. This module owns the pure format arithmetic — no filesystem
// access, no child processes — so it can be tested directly.
//
// Standard volume layout (file container, sector size 512):
//   0            primary header      (65536 bytes reserved, header uses 512)
//   65536        hidden header       (65536 bytes reserved)
//   131072       encrypted data area
//   size-131072  backup primary header
//   size-65536   backup hidden header
//
// Header layout (512 bytes):
//   0    salt                                    64 bytes, plaintext
//   64   'VERA'                                   4   |
//   68   header format version                    2   |
//   70   minimum program version                  2   |
//   72   CRC-32 of the 256-byte key field         4   |
//   76   reserved                                16   | encrypted with the
//   92   hidden volume size                       8   | header key, XTS,
//   100  volume size                              8   | data unit 0
//   108  encrypted area start offset              8   |
//   116  encrypted area length                    8   |
//   124  flags                                    4   |
//   128  sector size                              4   |
//   132  reserved                               120   |
//   252  CRC-32 of bytes 64..251                  4   |
//   256  key field (master keys)                256   |

const crypto = require('node:crypto');
const xtsMode = require('./crypto/xts.cjs');
const aesCipher = require('./crypto/aes.cjs');
const serpentCipher = require('./crypto/serpent.cjs');
const twofishCipher = require('./crypto/twofish.cjs');

const HEADER_SIZE = 512;
const SALT_SIZE = 64;
const ENCRYPTED_OFFSET = 64;
const ENCRYPTED_SIZE = HEADER_SIZE - ENCRYPTED_OFFSET;
const KEY_FIELD_OFFSET = 256;
const KEY_FIELD_SIZE = 256;
const HEADER_AREA_SIZE = 65536;
const DATA_AREA_OFFSET = HEADER_AREA_SIZE * 2;
const BACKUP_AREA_SIZE = HEADER_AREA_SIZE * 2;
const MAGIC = 'VERA';
const HEADER_VERSION = 5;
const MINIMUM_PROGRAM_VERSION = 0x010b;
const DEFAULT_SECTOR_SIZE = 512;
const NON_SYSTEM_ITERATIONS = 500000;
const PIM_BASE_ITERATIONS = 15000;
const PIM_ITERATIONS_PER_UNIT = 1000;

// Only ciphers whose primitives this build can actually perform are offered.
// A cipher we cannot execute is reported as unavailable rather than listed as
// if it worked.
const CIPHERS = Object.freeze({
  AES: { id: 'AES', label: 'AES', keyBytes: 64, algorithm: 'aes-256-xts', module: aesCipher, available: true },
  Serpent: { id: 'Serpent', label: 'Serpent', keyBytes: 64, algorithm: null, module: serpentCipher, available: true },
  Twofish: { id: 'Twofish', label: 'Twofish', keyBytes: 64, algorithm: null, module: twofishCipher, available: true },
  Camellia: { id: 'Camellia', label: 'Camellia', keyBytes: 64, algorithm: null, module: null, available: false, reason: 'Camellia has not been ported yet, so this build cannot read or write a Camellia volume.' },
  Kuznyechik: { id: 'Kuznyechik', label: 'Kuznyechik', keyBytes: 64, algorithm: null, module: null, available: false, reason: 'Kuznyechik has not been ported yet, so this build cannot read or write a Kuznyechik volume.' }
});

const PRFS = Object.freeze({
  'HMAC-SHA-512': { id: 'HMAC-SHA-512', digest: 'sha512', available: true },
  'HMAC-SHA-256': { id: 'HMAC-SHA-256', digest: 'sha256', available: true },
  'HMAC-BLAKE2s-256': { id: 'HMAC-BLAKE2s-256', digest: 'blake2s256', available: crypto.getHashes().includes('blake2s256') },
  'HMAC-Whirlpool': { id: 'HMAC-Whirlpool', digest: 'whirlpool', available: crypto.getHashes().includes('whirlpool') },
  'HMAC-Streebog': { id: 'HMAC-Streebog', digest: null, available: false }
});

function availableCiphers() {
  return Object.values(CIPHERS).map((cipher) => ({ id: cipher.id, label: cipher.label, available: cipher.available, reason: cipher.reason || null }));
}

function availablePrfs() {
  return Object.values(PRFS).map((prf) => ({ id: prf.id, available: prf.available, reason: prf.available ? null: 'This build’s crypto backend does not provide that hash.' }));
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function iterationCount(pim = 0) {
  const value = Number(pim) || 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) throw new Error('PIM must be a whole number between 0 and 65535.');
  return value === 0 ? NON_SYSTEM_ITERATIONS : PIM_BASE_ITERATIONS + value * PIM_ITERATIONS_PER_UNIT;
}

function resolveCipher(name = 'AES') {
  const cipher = CIPHERS[name];
  if (!cipher) throw new Error(`${name} is not a recognised VeraCrypt cipher.`);
  if (!cipher.available) throw new Error(cipher.reason);
  return cipher;
}

function resolvePrf(name = 'HMAC-SHA-512') {
  const prf = PRFS[name];
  if (!prf) throw new Error(`${name} is not a recognised VeraCrypt key derivation function.`);
  if (!prf.available) throw new Error(`${name} is not provided by this build’s crypto backend. Use HMAC-SHA-512.`);
  return prf;
}

function passwordBytes(password) {
  const bytes = Buffer.from(String(password), 'utf8');
  if (!bytes.length) throw new Error('Enter the volume password.');
  if (bytes.length > 128) throw new Error('VeraCrypt passwords are at most 128 bytes.');
  return bytes;
}

function deriveHeaderKey({ password, salt, prf, pim, keyBytes }) {
  return crypto.pbkdf2Sync(passwordBytes(password), salt, iterationCount(pim), keyBytes, resolvePrf(prf).digest);
}

// XTS refuses a key whose two halves are equal, which is also a real weakness,
// so key generation rejects that draw rather than shipping it.
function randomXtsKey(keyBytes) {
  for (;;) {
    const key = crypto.randomBytes(keyBytes);
    const half = keyBytes / 2;
    if (!key.subarray(0, half).equals(key.subarray(half))) return key;
  }
}

function tweak(dataUnitNumber) {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64LE(BigInt(dataUnitNumber), 0);
  return buffer;
}

// AES uses the platform's native XTS, which is hardware accelerated. The ported
// ciphers use this project's own XTS, which is proven byte-identical to that
// native mode in tests/crypto-ciphers.test.mjs.
function xts(cipher, key, dataUnitNumber, data, encrypt) {
  if (cipher.algorithm) {
    const factory = encrypt ? crypto.createCipheriv : crypto.createDecipheriv;
    const engine = factory(cipher.algorithm, key, tweak(dataUnitNumber));
    return Buffer.concat([engine.update(data), engine.final()]);
  }
  const mode = xtsMode.createXts(cipher.module, key);
  try {
    return encrypt ? mode.encrypt(dataUnitNumber, data) : mode.decrypt(dataUnitNumber, data);
  } finally {
    mode.destroy();
  }
}

function encryptHeaderArea(cipher, key, plaintext) { return xts(cipher, key, 0, plaintext, true); }
function decryptHeaderArea(cipher, key, ciphertext) { return xts(cipher, key, 0, ciphertext, false); }

function encryptDataUnit(cipher, key, dataUnitNumber, data) { return xts(resolveCipher(cipher), key, dataUnitNumber, data, true); }
function decryptDataUnit(cipher, key, dataUnitNumber, data) { return xts(resolveCipher(cipher), key, dataUnitNumber, data, false); }

// Builds the 512-byte header. `masterKey` is the key field's real content; the
// remainder of the field is random so the ciphertext leaks no key length.
function buildHeader({ salt, headerKey, cipher, masterKey, volumeSize, encryptedAreaStart, encryptedAreaLength, hiddenVolumeSize = 0, flags = 0, sectorSize = DEFAULT_SECTOR_SIZE }) {
  if (salt.length !== SALT_SIZE) throw new Error('The header salt must be 64 bytes.');
  const body = Buffer.alloc(ENCRYPTED_SIZE);
  const keyField = crypto.randomBytes(KEY_FIELD_SIZE);
  masterKey.copy(keyField, 0);
  keyField.copy(body, KEY_FIELD_OFFSET - ENCRYPTED_OFFSET);

  body.write(MAGIC, 0, 'ascii');
  body.writeUInt16BE(HEADER_VERSION, 4);
  body.writeUInt16BE(MINIMUM_PROGRAM_VERSION, 6);
  body.writeUInt32BE(crc32(keyField), 8);
  body.writeBigUInt64BE(BigInt(hiddenVolumeSize), 28);
  body.writeBigUInt64BE(BigInt(volumeSize), 36);
  body.writeBigUInt64BE(BigInt(encryptedAreaStart), 44);
  body.writeBigUInt64BE(BigInt(encryptedAreaLength), 52);
  body.writeUInt32BE(flags >>> 0, 60);
  body.writeUInt32BE(sectorSize >>> 0, 64);
  body.writeUInt32BE(crc32(body.subarray(0, 188)), 188);

  const header = Buffer.alloc(HEADER_SIZE);
  salt.copy(header, 0);
  encryptHeaderArea(cipher, headerKey, body).copy(header, ENCRYPTED_OFFSET);
  return header;
}

// Attempts to decrypt a header. Returns null when the password, PIM, PRF or
// cipher does not match — the two CRCs make a false positive vanishingly
// unlikely, which is exactly how VeraCrypt itself recognises a correct password.
function tryDecryptHeader({ header, password, pim = 0, prf = 'HMAC-SHA-512', cipherName = 'AES' }) {
  if (header.length < HEADER_SIZE) throw new Error('A VeraCrypt header is 512 bytes.');
  const cipher = resolveCipher(cipherName);
  const salt = header.subarray(0, SALT_SIZE);
  const headerKey = deriveHeaderKey({ password, salt, prf, pim, keyBytes: cipher.keyBytes });
  let body;
  try {
    body = decryptHeaderArea(cipher, headerKey, header.subarray(ENCRYPTED_OFFSET, HEADER_SIZE));
  } catch (_) {
    return null;
  }
  if (body.subarray(0, 4).toString('ascii') !== MAGIC) return null;
  if (body.readUInt32BE(188) !== crc32(body.subarray(0, 188))) return null;
  const keyField = body.subarray(KEY_FIELD_OFFSET - ENCRYPTED_OFFSET, KEY_FIELD_OFFSET - ENCRYPTED_OFFSET + KEY_FIELD_SIZE);
  if (body.readUInt32BE(8) !== crc32(keyField)) return null;

  return {
    cipher: cipher.id,
    prf,
    pim: Number(pim) || 0,
    iterations: iterationCount(pim),
    headerVersion: body.readUInt16BE(4),
    minimumProgramVersion: body.readUInt16BE(6),
    hiddenVolumeSize: Number(body.readBigUInt64BE(28)),
    volumeSize: Number(body.readBigUInt64BE(36)),
    encryptedAreaStart: Number(body.readBigUInt64BE(44)),
    encryptedAreaLength: Number(body.readBigUInt64BE(52)),
    flags: body.readUInt32BE(60),
    sectorSize: body.readUInt32BE(64) || DEFAULT_SECTOR_SIZE,
    masterKey: Buffer.from(keyField.subarray(0, cipher.keyBytes)),
    salt: Buffer.from(salt)
  };
}

module.exports = {
  HEADER_SIZE, SALT_SIZE, HEADER_AREA_SIZE, DATA_AREA_OFFSET, BACKUP_AREA_SIZE, DEFAULT_SECTOR_SIZE,
  NON_SYSTEM_ITERATIONS, CIPHERS, PRFS,
  availableCiphers, availablePrfs, crc32, iterationCount, resolveCipher, resolvePrf,
  deriveHeaderKey, randomXtsKey, buildHeader, tryDecryptHeader,
  encryptHeaderArea, decryptHeaderArea, encryptDataUnit, decryptDataUnit
};
