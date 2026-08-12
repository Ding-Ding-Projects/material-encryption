'use strict';

// Serpent, ported to match the implementation in the VeraCrypt source tree
// (src/Crypto/Serpent.c at tag VeraCrypt_1.26.29). Correctness is proven against
// that tree's own published ECB vector rather than asserted — see
// tests/serpent.test.mjs.
//
// The block is held as four 32-bit little-endian words in the bitslice
// convention: bit n of each word forms one S-box input nibble.

const PHI = 0x9e3779b9;
const ROUNDS = 32;

const SBOXES = [
  [3, 8, 15, 1, 10, 6, 5, 11, 14, 13, 4, 2, 7, 0, 9, 12],
  [15, 12, 2, 7, 9, 0, 5, 10, 1, 11, 14, 8, 6, 13, 3, 4],
  [8, 6, 7, 9, 3, 12, 10, 15, 13, 1, 14, 4, 0, 11, 5, 2],
  [0, 15, 11, 8, 12, 9, 6, 3, 13, 1, 2, 4, 10, 7, 5, 14],
  [1, 15, 8, 3, 12, 0, 11, 6, 2, 5, 4, 10, 9, 14, 7, 13],
  [15, 5, 2, 11, 4, 10, 9, 12, 0, 3, 14, 8, 13, 6, 7, 1],
  [7, 2, 12, 5, 8, 4, 6, 11, 14, 9, 1, 15, 13, 3, 10, 0],
  [1, 13, 15, 0, 14, 8, 2, 11, 7, 4, 12, 10, 9, 3, 5, 6]
];

const INVERSE_SBOXES = SBOXES.map((box) => {
  const inverse = new Array(16);
  box.forEach((output, input) => { inverse[output] = input; });
  return inverse;
});

function applySbox(box, x) {
  let y0 = 0, y1 = 0, y2 = 0, y3 = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    const input = ((x[0] >>> bit) & 1) | (((x[1] >>> bit) & 1) << 1) | (((x[2] >>> bit) & 1) << 2) | (((x[3] >>> bit) & 1) << 3);
    const output = box[input];
    y0 |= (output & 1) << bit;
    y1 |= ((output >>> 1) & 1) << bit;
    y2 |= ((output >>> 2) & 1) << bit;
    y3 |= ((output >>> 3) & 1) << bit;
  }
  x[0] = y0 >>> 0; x[1] = y1 >>> 0; x[2] = y2 >>> 0; x[3] = y3 >>> 0;
}

function rotl(value, count) {
  return (((value << count) | (value >>> (32 - count))) >>> 0);
}

function linearTransform(x) {
  let x0 = rotl(x[0], 13);
  let x2 = rotl(x[2], 3);
  let x1 = (x[1] ^ x0 ^ x2) >>> 0;
  let x3 = (x[3] ^ x2 ^ ((x0 << 3) >>> 0)) >>> 0;
  x1 = rotl(x1, 1);
  x3 = rotl(x3, 7);
  x0 = (x0 ^ x1 ^ x3) >>> 0;
  x2 = (x2 ^ x3 ^ ((x1 << 7) >>> 0)) >>> 0;
  x[0] = rotl(x0, 5);
  x[1] = x1;
  x[2] = rotl(x2, 22);
  x[3] = x3;
}

function inverseLinearTransform(x) {
  let x2 = rotl(x[2], 32 - 22);
  let x0 = rotl(x[0], 32 - 5);
  const x1 = x[1];
  const x3 = x[3];
  x2 = (x2 ^ x3 ^ ((x1 << 7) >>> 0)) >>> 0;
  x0 = (x0 ^ x1 ^ x3) >>> 0;
  const y3 = rotl(x3, 32 - 7);
  const y1 = rotl(x1, 32 - 1);
  const z3 = (y3 ^ x2 ^ ((x0 << 3) >>> 0)) >>> 0;
  const z1 = (y1 ^ x0 ^ x2) >>> 0;
  x[2] = rotl(x2, 32 - 3);
  x[0] = rotl(x0, 32 - 13);
  x[1] = z1;
  x[3] = z3;
}

// Serpent's key schedule pads a short key with a single set bit, exactly as the
// specification requires. VeraCrypt only ever supplies 32-byte keys.
function expandKey(key) {
  if (!Buffer.isBuffer(key) || key.length < 16 || key.length > 32) throw new Error('A Serpent key must be 16 to 32 bytes.');
  const padded = Buffer.alloc(32);
  key.copy(padded, 0);
  if (key.length < 32) padded[key.length] = 0x01;

  const w = new Uint32Array(140);
  for (let index = 0; index < 8; index += 1) w[index] = padded.readUInt32LE(index * 4);
  for (let index = 8; index < 140; index += 1) {
    const previous = (w[index - 8] ^ w[index - 5] ^ w[index - 3] ^ w[index - 1] ^ PHI ^ (index - 8)) >>> 0;
    w[index] = rotl(previous, 11);
  }

  const subkeys = [];
  const slice = new Uint32Array(4);
  for (let round = 0; round <= ROUNDS; round += 1) {
    for (let word = 0; word < 4; word += 1) slice[word] = w[8 + round * 4 + word];
    applySbox(SBOXES[(3 - round + 8 * 4) % 8], slice);
    subkeys.push(Uint32Array.from(slice));
  }
  padded.fill(0);
  return subkeys;
}

function encryptBlock(subkeys, block, offset = 0, out = block, outOffset = offset) {
  const x = new Uint32Array(4);
  for (let word = 0; word < 4; word += 1) x[word] = block.readUInt32LE(offset + word * 4);
  for (let round = 0; round < ROUNDS - 1; round += 1) {
    for (let word = 0; word < 4; word += 1) x[word] = (x[word] ^ subkeys[round][word]) >>> 0;
    applySbox(SBOXES[round % 8], x);
    linearTransform(x);
  }
  for (let word = 0; word < 4; word += 1) x[word] = (x[word] ^ subkeys[ROUNDS - 1][word]) >>> 0;
  applySbox(SBOXES[(ROUNDS - 1) % 8], x);
  for (let word = 0; word < 4; word += 1) out.writeUInt32LE((x[word] ^ subkeys[ROUNDS][word]) >>> 0, outOffset + word * 4);
  return out;
}

function decryptBlock(subkeys, block, offset = 0, out = block, outOffset = offset) {
  const x = new Uint32Array(4);
  for (let word = 0; word < 4; word += 1) x[word] = (block.readUInt32LE(offset + word * 4) ^ subkeys[ROUNDS][word]) >>> 0;
  applySbox(INVERSE_SBOXES[(ROUNDS - 1) % 8], x);
  for (let word = 0; word < 4; word += 1) x[word] = (x[word] ^ subkeys[ROUNDS - 1][word]) >>> 0;
  for (let round = ROUNDS - 2; round >= 0; round -= 1) {
    inverseLinearTransform(x);
    applySbox(INVERSE_SBOXES[round % 8], x);
    for (let word = 0; word < 4; word += 1) x[word] = (x[word] ^ subkeys[round][word]) >>> 0;
  }
  for (let word = 0; word < 4; word += 1) out.writeUInt32LE(x[word] >>> 0, outOffset + word * 4);
  return out;
}

function createCipher(key) {
  const subkeys = expandKey(key);
  return {
    blockSize: 16,
    encrypt: (block, offset, out, outOffset) => encryptBlock(subkeys, block, offset, out, outOffset),
    decrypt: (block, offset, out, outOffset) => decryptBlock(subkeys, block, offset, out, outOffset),
    destroy: () => subkeys.forEach((subkey) => subkey.fill(0))
  };
}

module.exports = { createCipher, expandKey, encryptBlock, decryptBlock, BLOCK_SIZE: 16 };