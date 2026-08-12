'use strict';

// AES block adapter over the platform's own implementation, so AES uses the
// hardware-accelerated path rather than a hand-written one. It exposes the same
// shape as the Serpent and Twofish ports, which lets the cipher registry treat
// all three identically.
//
// Bulk AES-XTS still goes through Node's native aes-256-xts; this adapter exists
// for the uniform registry and for cross-checking the XTS implementation against
// that native mode in tests.

const crypto = require('node:crypto');

const BLOCK_SIZE = 16;

function single(algorithm, key, input, offset, out, outOffset, encrypt) {
  const engine = encrypt ? crypto.createCipheriv(algorithm, key, null) : crypto.createDecipheriv(algorithm, key, null);
  engine.setAutoPadding(false);
  const result = Buffer.concat([engine.update(input.subarray(offset, offset + BLOCK_SIZE)), engine.final()]);
  result.copy(out, outOffset);
  return out;
}

function createCipher(key) {
  if (!Buffer.isBuffer(key) || ![16, 24, 32].includes(key.length)) throw new Error('An AES key must be 128, 192 or 256 bits.');
  const algorithm = `aes-${key.length * 8}-ecb`;
  const held = Buffer.from(key);
  return {
    blockSize: BLOCK_SIZE,
    encrypt: (block, offset = 0, out = block, outOffset = offset) => single(algorithm, held, block, offset, out, outOffset, true),
    decrypt: (block, offset = 0, out = block, outOffset = offset) => single(algorithm, held, block, offset, out, outOffset, false),
    destroy: () => held.fill(0)
  };
}

module.exports = { createCipher, BLOCK_SIZE };
