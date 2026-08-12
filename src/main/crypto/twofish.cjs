'use strict';

// Twofish, ported from the VeraCrypt source tree (src/Crypto/Twofish.c at tag
// VeraCrypt_1.26.29). The upstream file ships pre-computed Q, MDS and RS tables
// alongside the generator code that produces them; this port keeps the
// generators, so the tables are derived here rather than transcribed — a
// transcription error in 2,300 constants would be invisible, a generator error
// fails the vector in tests/twofish.test.mjs.

const G_M = 0x0169;   // GF(2^8) modulus for the MDS matrix
const G_MOD = 0x14d;  // GF(2^8) modulus for the RS reed-solomon remainder

const TAB_5B = [0, G_M >> 2, G_M >> 1, (G_M >> 1) ^ (G_M >> 2)];
const TAB_EF = [0, (G_M >> 1) ^ (G_M >> 2), G_M >> 1, G_M >> 2];

const ffm5b = (x) => (x ^ (x >>> 2) ^ TAB_5B[x & 3]) & 0xff;
const ffmef = (x) => (x ^ (x >>> 1) ^ (x >>> 2) ^ TAB_EF[x & 3]) & 0xff;

const ROR4 = [0, 8, 1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
const ASHX = [0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 5, 14, 7];

const QT0 = [[8, 1, 7, 13, 6, 15, 3, 2, 0, 11, 5, 9, 14, 12, 10, 4], [2, 8, 11, 13, 15, 7, 6, 14, 3, 1, 9, 4, 0, 10, 12, 5]];
const QT1 = [[14, 12, 11, 8, 1, 2, 3, 5, 15, 4, 10, 6, 7, 0, 9, 13], [1, 14, 2, 11, 4, 12, 3, 7, 6, 13, 10, 5, 15, 9, 0, 8]];
const QT2 = [[11, 10, 5, 14, 6, 13, 9, 0, 12, 8, 15, 3, 2, 4, 7, 1], [4, 12, 7, 5, 1, 6, 9, 10, 0, 14, 13, 8, 2, 11, 3, 15]];
const QT3 = [[13, 7, 15, 4, 1, 2, 6, 14, 9, 11, 3, 0, 8, 5, 12, 10], [11, 9, 5, 1, 12, 3, 13, 14, 6, 4, 7, 15, 2, 0, 8, 10]];

function qp(n, x) {
  const a0 = x >>> 4, b0 = x & 15;
  const a1 = a0 ^ b0, b1 = ROR4[b0] ^ ASHX[a0];
  const a2 = QT0[n][a1], b2 = QT1[n][b1];
  const a3 = a2 ^ b2, b3 = ROR4[b2] ^ ASHX[a2];
  const a4 = QT2[n][a3], b4 = QT3[n][b3];
  return ((b4 << 4) | a4) & 0xff;
}

const Q = [new Uint8Array(256), new Uint8Array(256)];
for (let index = 0; index < 256; index += 1) {
  Q[0][index] = qp(0, index);
  Q[1][index] = qp(1, index);
}

// The MDS matrix folded into the q permutations, one table per column.
const M_TAB = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
for (let index = 0; index < 256; index += 1) {
  let f01 = Q[1][index], f5b = ffm5b(f01), fef = ffmef(f01);
  M_TAB[0][index] = (f01 + (f5b << 8) + (fef << 16) + (fef << 24)) >>> 0;
  M_TAB[2][index] = (f5b + (fef << 8) + (f01 << 16) + (fef << 24)) >>> 0;
  f01 = Q[0][index]; f5b = ffm5b(f01); fef = ffmef(f01);
  M_TAB[1][index] = (fef + (fef << 8) + (f5b << 16) + (f01 << 24)) >>> 0;
  M_TAB[3][index] = (f5b + (f01 << 8) + (fef << 16) + (f5b << 24)) >>> 0;
}

const rotl = (value, count) => (((value << count) | (value >>> (32 - count))) >>> 0);
const rotr = (value, count) => (((value >>> count) | (value << (32 - count))) >>> 0);
const byteOf = (value, index) => (value >>> (8 * index)) & 0xff;
const add = (a, b) => ((a + b) >>> 0);

// Reed-Solomon remainder, which turns each 64-bit key half into one S-box word.
function mdsRemainder(p0, p1) {
  let low = p0 >>> 0;
  let high = p1 >>> 0;
  for (let round = 0; round < 8; round += 1) {
    const t = high >>> 24;
    high = (((high << 8) >>> 0) | (low >>> 24)) >>> 0;
    low = (low << 8) >>> 0;
    let u = (t << 1) >>> 0;
    if (t & 0x80) u = (u ^ G_MOD) >>> 0;
    high = (high ^ t ^ ((u << 16) >>> 0)) >>> 0;
    u = (u ^ (t >>> 1)) >>> 0;
    if (t & 0x01) u = (u ^ (G_MOD >>> 1)) >>> 0;
    high = (high ^ ((u << 24) >>> 0) ^ ((u << 8) >>> 0)) >>> 0;
  }
  return high >>> 0;
}

// The h function for a 256-bit key: four q layers, then the MDS mix.
function hFunction(x, key) {
  let b0 = byteOf(x, 0), b1 = byteOf(x, 1), b2 = byteOf(x, 2), b3 = byteOf(x, 3);
  b0 = Q[1][b0] ^ byteOf(key[3], 0);
  b1 = Q[0][b1] ^ byteOf(key[3], 1);
  b2 = Q[0][b2] ^ byteOf(key[3], 2);
  b3 = Q[1][b3] ^ byteOf(key[3], 3);
  b0 = Q[1][b0] ^ byteOf(key[2], 0);
  b1 = Q[1][b1] ^ byteOf(key[2], 1);
  b2 = Q[0][b2] ^ byteOf(key[2], 2);
  b3 = Q[0][b3] ^ byteOf(key[2], 3);
  b0 = Q[0][Q[0][b0] ^ byteOf(key[1], 0)] ^ byteOf(key[0], 0);
  b1 = Q[0][Q[1][b1] ^ byteOf(key[1], 1)] ^ byteOf(key[0], 1);
  b2 = Q[1][Q[0][b2] ^ byteOf(key[1], 2)] ^ byteOf(key[0], 2);
  b3 = Q[1][Q[1][b3] ^ byteOf(key[1], 3)] ^ byteOf(key[0], 3);
  return (M_TAB[0][b0] ^ M_TAB[1][b1] ^ M_TAB[2][b2] ^ M_TAB[3][b3]) >>> 0;
}

function expandKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('This Twofish port takes a 256-bit key, as VeraCrypt always supplies.');
  const words = new Uint32Array(8);
  for (let index = 0; index < 8; index += 1) words[index] = key.readUInt32LE(index * 4);

  const evenKey = new Uint32Array(4);
  const oddKey = new Uint32Array(4);
  const sKey = new Uint32Array(4);
  for (let index = 0; index < 4; index += 1) {
    const a = words[index * 2];
    const b = words[index * 2 + 1];
    evenKey[index] = a;
    oddKey[index] = b;
    sKey[4 - index - 1] = mdsRemainder(a, b);
  }

  const roundKeys = new Uint32Array(40);
  for (let index = 0; index < 40; index += 2) {
    const a = hFunction(Math.imul(0x01010101, index) >>> 0, evenKey);
    const b = rotl(hFunction(add(Math.imul(0x01010101, index) >>> 0, 0x01010101), oddKey), 8);
    roundKeys[index] = add(a, b);
    roundKeys[index + 1] = rotl(add(a, add(b, b)), 9);
  }

  // The key-dependent S-boxes, folded into the MDS tables exactly as the
  // upstream gen_mk_tab does.
  const mk = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let index = 0; index < 256; index += 1) {
    mk[0][index] = M_TAB[0][Q[0][Q[0][Q[1][Q[1][index] ^ byteOf(sKey[3], 0)] ^ byteOf(sKey[2], 0)] ^ byteOf(sKey[1], 0)] ^ byteOf(sKey[0], 0)];
    mk[1][index] = M_TAB[1][Q[0][Q[1][Q[1][Q[0][index] ^ byteOf(sKey[3], 1)] ^ byteOf(sKey[2], 1)] ^ byteOf(sKey[1], 1)] ^ byteOf(sKey[0], 1)];
    mk[2][index] = M_TAB[2][Q[1][Q[0][Q[0][Q[0][index] ^ byteOf(sKey[3], 2)] ^ byteOf(sKey[2], 2)] ^ byteOf(sKey[1], 2)] ^ byteOf(sKey[0], 2)];
    mk[3][index] = M_TAB[3][Q[1][Q[1][Q[0][Q[1][index] ^ byteOf(sKey[3], 3)] ^ byteOf(sKey[2], 3)] ^ byteOf(sKey[1], 3)] ^ byteOf(sKey[0], 3)];
  }
  words.fill(0); evenKey.fill(0); oddKey.fill(0); sKey.fill(0);
  return { roundKeys, mk };
}

const g0 = (mk, x) => (mk[0][x & 0xff] ^ mk[1][(x >>> 8) & 0xff] ^ mk[2][(x >>> 16) & 0xff] ^ mk[3][(x >>> 24) & 0xff]) >>> 0;
const g1 = (mk, x) => (mk[0][(x >>> 24) & 0xff] ^ mk[1][x & 0xff] ^ mk[2][(x >>> 8) & 0xff] ^ mk[3][(x >>> 16) & 0xff]) >>> 0;

function encryptBlock(state, block, offset = 0, out = block, outOffset = offset) {
  const { roundKeys: rk, mk } = state;
  let x0 = (block.readUInt32LE(offset) ^ rk[0]) >>> 0;
  let x1 = (block.readUInt32LE(offset + 4) ^ rk[1]) >>> 0;
  let x2 = (block.readUInt32LE(offset + 8) ^ rk[2]) >>> 0;
  let x3 = (block.readUInt32LE(offset + 12) ^ rk[3]) >>> 0;

  for (let round = 0; round < 8; round += 1) {
    let t0 = g0(mk, x0), t1 = g1(mk, x1);
    x2 = rotr((x2 ^ add(t0, add(t1, rk[4 * round + 8]))) >>> 0, 1);
    x3 = (rotl(x3, 1) ^ add(t0, add(t1, add(t1, rk[4 * round + 9])))) >>> 0;
    t0 = g0(mk, x2); t1 = g1(mk, x3);
    x0 = rotr((x0 ^ add(t0, add(t1, rk[4 * round + 10]))) >>> 0, 1);
    x1 = (rotl(x1, 1) ^ add(t0, add(t1, add(t1, rk[4 * round + 11])))) >>> 0;
  }

  out.writeUInt32LE((x2 ^ rk[4]) >>> 0, outOffset);
  out.writeUInt32LE((x3 ^ rk[5]) >>> 0, outOffset + 4);
  out.writeUInt32LE((x0 ^ rk[6]) >>> 0, outOffset + 8);
  out.writeUInt32LE((x1 ^ rk[7]) >>> 0, outOffset + 12);
  return out;
}

function decryptBlock(state, block, offset = 0, out = block, outOffset = offset) {
  const { roundKeys: rk, mk } = state;
  let x0 = (block.readUInt32LE(offset) ^ rk[4]) >>> 0;
  let x1 = (block.readUInt32LE(offset + 4) ^ rk[5]) >>> 0;
  let x2 = (block.readUInt32LE(offset + 8) ^ rk[6]) >>> 0;
  let x3 = (block.readUInt32LE(offset + 12) ^ rk[7]) >>> 0;

  for (let round = 7; round >= 0; round -= 1) {
    let t0 = g0(mk, x0), t1 = g1(mk, x1);
    x2 = (rotl(x2, 1) ^ add(t0, add(t1, rk[4 * round + 10]))) >>> 0;
    x3 = rotr((x3 ^ add(t0, add(t1, add(t1, rk[4 * round + 11])))) >>> 0, 1);
    t0 = g0(mk, x2); t1 = g1(mk, x3);
    x0 = (rotl(x0, 1) ^ add(t0, add(t1, rk[4 * round + 8]))) >>> 0;
    x1 = rotr((x1 ^ add(t0, add(t1, add(t1, rk[4 * round + 9])))) >>> 0, 1);
  }

  out.writeUInt32LE((x2 ^ rk[0]) >>> 0, outOffset);
  out.writeUInt32LE((x3 ^ rk[1]) >>> 0, outOffset + 4);
  out.writeUInt32LE((x0 ^ rk[2]) >>> 0, outOffset + 8);
  out.writeUInt32LE((x1 ^ rk[3]) >>> 0, outOffset + 12);
  return out;
}

function createCipher(key) {
  const state = expandKey(key);
  return {
    blockSize: 16,
    encrypt: (block, offset, out, outOffset) => encryptBlock(state, block, offset, out, outOffset),
    decrypt: (block, offset, out, outOffset) => decryptBlock(state, block, offset, out, outOffset),
    destroy: () => { state.roundKeys.fill(0); state.mk.forEach((table) => table.fill(0)); }
  };
}

module.exports = { createCipher, expandKey, encryptBlock, decryptBlock, BLOCK_SIZE: 16 };
