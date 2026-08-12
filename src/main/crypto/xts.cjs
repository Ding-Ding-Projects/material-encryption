'use strict';

// XTS mode over any 128-bit block cipher, matching VeraCrypt's EncryptBufferXTS
// (src/Common/Crypto.c). Node provides AES-XTS natively; Serpent and Twofish do
// not exist in its crypto backend, so they run through this implementation.
//
// The tweak is the data unit number as a little-endian 64-bit value, encrypted
// once per data unit with the secondary key, then multiplied by the primitive
// element of GF(2^128) for each successive 16-byte block.

const BLOCK_SIZE = 16;

function whitenNext(whitening) {
  // Multiply by x in GF(2^128) with the reduction polynomial x^128 + x^7 + x^2 + x + 1.
  let carry = 0;
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    const next = (whitening[index] >>> 7) & 1;
    whitening[index] = ((whitening[index] << 1) | carry) & 0xff;
    carry = next;
  }
  if (carry) whitening[0] ^= 0x87;
}

function makeWhitening(secondary, dataUnitNumber) {
  const tweak = Buffer.alloc(BLOCK_SIZE);
  tweak.writeBigUInt64LE(BigInt(dataUnitNumber), 0);
  secondary.encrypt(tweak, 0, tweak, 0);
  return tweak;
}

// `startBlock` lets a caller resume mid-unit, which the header path never needs
// but the sector path does when a read does not begin on a unit boundary.
function transform(primary, secondary, dataUnitNumber, data, encrypt, startBlock = 0) {
  if (data.length % BLOCK_SIZE !== 0) throw new Error('XTS input must be a whole number of 16-byte blocks.');
  const whitening = makeWhitening(secondary, dataUnitNumber);
  for (let skipped = 0; skipped < startBlock; skipped += 1) whitenNext(whitening);

  const out = Buffer.alloc(data.length);
  const scratch = Buffer.alloc(BLOCK_SIZE);
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    for (let index = 0; index < BLOCK_SIZE; index += 1) scratch[index] = data[offset + index] ^ whitening[index];
    if (encrypt) primary.encrypt(scratch, 0, scratch, 0);
    else primary.decrypt(scratch, 0, scratch, 0);
    for (let index = 0; index < BLOCK_SIZE; index += 1) out[offset + index] = scratch[index] ^ whitening[index];
    whitenNext(whitening);
  }
  scratch.fill(0);
  whitening.fill(0);
  return out;
}

// A VeraCrypt XTS key is the primary and secondary key concatenated, in that
// order, so a 64-byte key means two 256-bit halves.
function splitKey(key) {
  if (!Buffer.isBuffer(key) || key.length % 2 !== 0) throw new Error('An XTS key is two equal halves.');
  const half = key.length / 2;
  const primary = key.subarray(0, half);
  const secondary = key.subarray(half);
  if (primary.equals(secondary)) throw new Error('The two halves of an XTS key must differ.');
  return { primary, secondary };
}

function createXts(cipherModule, key) {
  const { primary, secondary } = splitKey(key);
  const primaryCipher = cipherModule.createCipher(Buffer.from(primary));
  const secondaryCipher = cipherModule.createCipher(Buffer.from(secondary));
  return {
    encrypt: (dataUnitNumber, data, startBlock = 0) => transform(primaryCipher, secondaryCipher, dataUnitNumber, data, true, startBlock),
    decrypt: (dataUnitNumber, data, startBlock = 0) => transform(primaryCipher, secondaryCipher, dataUnitNumber, data, false, startBlock),
    destroy: () => { primaryCipher.destroy(); secondaryCipher.destroy(); }
  };
}

module.exports = { createXts, splitKey, BLOCK_SIZE };
