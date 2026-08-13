import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serpent = require('../src/main/crypto/serpent.cjs');
const twofish = require('../src/main/crypto/twofish.cjs');
const aes = require('../src/main/crypto/aes.cjs');
const xts = require('../src/main/crypto/xts.cjs');
const fmt = require('../src/main/volume-format.cjs');

// The ECB vectors below are the ones in the VeraCrypt source tree itself
// (src/Common/Tests.c at tag VeraCrypt_1.26.29). Matching them is what makes
// these ports interoperable rather than merely self-consistent: a cipher that
// only agrees with itself produces containers nothing else can open.
const VECTORS = [
  {
    name: 'Serpent',
    module: serpent,
    key: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    plaintext: '000102030405060708090a0b0c0d0e0f',
    ciphertext: 'de269ff833e432b85b2e88d2701ce75c'
  },
  {
    name: 'Twofish',
    module: twofish,
    key: 'd43bb7556ea32e46f2a282b7d45b4e0d57ff739d4dc92c1bd7fc01700cc8216f',
    plaintext: '90afe91bb288544f2c32dc239b2635e6',
    ciphertext: '6cb4561c40bf0a9705931cb6d408e7fa'
  }
];

for (const vector of VECTORS) {
  test(`${vector.name} matches the VeraCrypt source tree's ECB vector`, () => {
    const cipher = vector.module.createCipher(Buffer.from(vector.key, 'hex'));
    const plaintext = Buffer.from(vector.plaintext, 'hex');
    const produced = Buffer.alloc(16);
    cipher.encrypt(plaintext, 0, produced, 0);
    assert.equal(produced.toString('hex'), vector.ciphertext);

    const recovered = Buffer.alloc(16);
    cipher.decrypt(produced, 0, recovered, 0);
    assert.ok(recovered.equals(plaintext), 'decryption must invert encryption');
  });

  test(`${vector.name} rejects a key length VeraCrypt never produces`, () => {
    assert.throws(() => vector.module.createCipher(Buffer.alloc(8)));
  });
}

// This is the load-bearing check for the ported ciphers. Their ECB vectors prove
// the primitives; this proves the mode wrapped around them, by producing the
// exact bytes the platform's own AES-XTS does for the same key and data unit.
// Without it, a subtly wrong tweak schedule would still round-trip perfectly
// while writing containers no other implementation could read.
test('the ported XTS mode is byte-identical to the platform AES-XTS', () => {
  for (const dataUnitNumber of [0, 1, 42, 65535, 1048576]) {
    const key = Buffer.concat([crypto.randomBytes(32), crypto.randomBytes(32)]);
    const data = crypto.randomBytes(512);

    const tweak = Buffer.alloc(16);
    tweak.writeBigUInt64LE(BigInt(dataUnitNumber), 0);
    const engine = crypto.createCipheriv('aes-256-xts', key, tweak);
    const native = Buffer.concat([engine.update(data), engine.final()]);

    const mode = xts.createXts(aes, key);
    assert.ok(mode.encrypt(dataUnitNumber, data).equals(native), `data unit ${dataUnitNumber} must match the native mode`);
    mode.destroy();
  }
});

test('XTS carries the tweak across block boundaries, not just the first block', () => {
  // A tweak that failed to advance would leave identical plaintext blocks
  // encrypting to identical ciphertext blocks, which is exactly the leak XTS
  // exists to prevent.
  const key = Buffer.concat([crypto.randomBytes(32), crypto.randomBytes(32)]);
  const data = Buffer.alloc(512, 0xab);
  const mode = xts.createXts(serpent, key);
  const encrypted = mode.encrypt(3, data);
  const first = encrypted.subarray(0, 16);
  for (let offset = 16; offset < 512; offset += 16) {
    assert.ok(!first.equals(encrypted.subarray(offset, offset + 16)), `block at ${offset} repeated the first block`);
  }
  assert.ok(mode.decrypt(3, encrypted).equals(data));
  mode.destroy();
});

test('the same plaintext encrypts differently under different data units', () => {
  const key = Buffer.concat([crypto.randomBytes(32), crypto.randomBytes(32)]);
  const data = crypto.randomBytes(512);
  const mode = xts.createXts(twofish, key);
  assert.ok(!mode.encrypt(0, data).equals(mode.encrypt(1, data)));
  mode.destroy();
});

test('an XTS key whose halves match is refused', () => {
  const half = crypto.randomBytes(32);
  assert.throws(() => xts.createXts(serpent, Buffer.concat([half, half])), /halves/);
});

// The packaged application runs on Electron's BoringSSL, which provides no XTS
// cipher at all — asking for aes-256-xts there fails with "Unknown cipher".
// Under Node's OpenSSL it exists, so a suite that only ever runs under Node
// cannot tell the two apart, and every AES container silently became unopenable
// in the shipped build while all of these tests passed. This asserts the
// fallback path produces the same bytes, so either runtime reads the other's
// containers.
test('AES falls back to the ported XTS when the runtime has no native XTS, byte for byte', () => {
  const key = Buffer.concat([crypto.randomBytes(32), crypto.randomBytes(32)]);
  const data = crypto.randomBytes(1024);

  for (const dataUnitNumber of [0, 5, 4096]) {
    const tweak = Buffer.alloc(16);
    tweak.writeBigUInt64LE(BigInt(dataUnitNumber), 0);
    const engine = crypto.createCipheriv('aes-256-xts', key, tweak);
    const native = Buffer.concat([engine.update(data), engine.final()]);

    const mode = xts.createXts(aes, key);
    const ported = mode.encrypt(dataUnitNumber, data);
    mode.destroy();

    assert.ok(ported.equals(native), `data unit ${dataUnitNumber} must match the native mode exactly`);
  }
});

test('the AES cipher entry only claims a native algorithm the runtime actually has', () => {
  const nativeAvailable = crypto.getCiphers().includes('aes-256-xts');
  const aesEntry = fmt.CIPHERS.AES;
  assert.equal(aesEntry.available, true, 'AES must always be available');
  if (nativeAvailable) {
    assert.equal(aesEntry.algorithm, 'aes-256-xts');
  } else {
    assert.equal(aesEntry.algorithm, null, 'without native XTS the entry must fall back rather than name a cipher that does not exist');
  }
  // Either way a block-cipher module must back it, or the fallback has nothing
  // to fall back to.
  assert.equal(typeof aesEntry.module?.createCipher, 'function');
});
