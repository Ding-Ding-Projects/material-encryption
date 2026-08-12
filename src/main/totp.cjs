'use strict';

const crypto = require('node:crypto');

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let index = 0; index < bits.length; index += 5) result += alphabet[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return result;
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/g, '').replace(/\s/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret, counterValue, { algorithm = 'sha1', digits = 6 } = {}) {
  if (!['sha1', 'sha256', 'sha512'].includes(algorithm) || !Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('Unsupported TOTP parameters.');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(counterValue));
  const digest = crypto.createHmac(algorithm, base32Decode(secret)).update(counter).digest();
  const position = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(position) & 0x7fffffff) % (10 ** digits);
  return String(number).padStart(digits, '0');
}

function totp(secret, time = Date.now(), offset = 0, options = {}) {
  const period = options.period ?? 30;
  if (!Number.isInteger(period) || period < 1 || period > 300) throw new Error('Unsupported TOTP period.');
  return hotp(secret, Math.floor(time / (period * 1000)) + offset, options);
}

module.exports = { base32Encode, base32Decode, hotp, totp };
