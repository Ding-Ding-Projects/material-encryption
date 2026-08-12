import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { base32Encode, base32Decode, totp } = require('../src/main/totp.cjs');

test('base32 round-trips arbitrary bytes', () => {
  const input = Buffer.from([0, 1, 127, 128, 255]);
  assert.deepEqual(base32Decode(base32Encode(input)), input);
});

test('RFC 6238 vectors pass for SHA-1, SHA-256, and SHA-512', () => {
  const vectors = [
    ['sha1', '12345678901234567890', '94287082'],
    ['sha256', '12345678901234567890123456789012', '46119246'],
    ['sha512', '1234567890123456789012345678901234567890123456789012345678901234', '90693936']
  ];
  for (const [algorithm, secret, expected] of vectors) assert.equal(totp(base32Encode(Buffer.from(secret)), 59_000, 0, { algorithm, digits: 8, period: 30 }), expected);
});

test('six-digit output and bounded parameters are enforced', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp(secret, 59_000), '287082');
  assert.throws(() => totp(secret, 59_000, 0, { digits: 5 }), /Unsupported/);
  assert.throws(() => totp(secret, 59_000, 0, { period: 0 }), /Unsupported/);
});
