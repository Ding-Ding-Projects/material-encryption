'use strict';

// Cipher throughput measured by actually encrypting and decrypting a buffer
// through this build's real XTS path — the same functions the volume engine
// uses. Nothing here is estimated, extrapolated, or remembered from a table:
// every number returned was produced by work this process just did.
//
// Ciphers this build cannot perform are reported as unavailable with the exact
// reason from the format module, never with a throughput figure.

const format = require('./volume-format.cjs');

// Deliberately modest. Serpent and Twofish run in JavaScript here, so a large
// buffer or a high iteration count would stall the main process for seconds at
// a time. One mebibyte, twice per direction, is enough for a stable figure and
// short enough that the whole run stays interactive.
const BUFFER_BYTES = 1024 * 1024;
const ITERATIONS = 2;
const DATA_UNIT_BYTES = 512;

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function megabytesPerSecond(bytes, milliseconds) {
  if (!(milliseconds > 0)) return 0;
  return (bytes / (1024 * 1024)) / (milliseconds / 1000);
}

// One pass over the buffer, a data unit at a time, exactly as the sector path
// does. Timing a single giant call would measure a shape the engine never uses.
function pass(cipherId, key, buffer, encrypt) {
  const started = process.hrtime.bigint();
  for (let offset = 0; offset < buffer.length; offset += DATA_UNIT_BYTES) {
    const unit = buffer.subarray(offset, offset + DATA_UNIT_BYTES);
    const number = offset / DATA_UNIT_BYTES;
    if (encrypt) format.encryptDataUnit(cipherId, key, number, unit);
    else format.decryptDataUnit(cipherId, key, number, unit);
  }
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function runBenchmark() {
  const ciphers = format.availableCiphers();
  const buffer = Buffer.alloc(BUFFER_BYTES, 0xa5);
  const rows = [];

  for (const cipher of ciphers) {
    if (!cipher.available) {
      rows.push({ id: cipher.id, label: cipher.label, available: false, reason: cipher.reason, encryptMbPerSecond: null, decryptMbPerSecond: null, meanMbPerSecond: null });
      continue;
    }
    await yieldToLoop();
    let key;
    try {
      key = format.randomXtsKey(format.resolveCipher(cipher.id).keyBytes);
    } catch (error) {
      rows.push({ id: cipher.id, label: cipher.label, available: false, reason: error instanceof Error ? error.message : String(error), encryptMbPerSecond: null, decryptMbPerSecond: null, meanMbPerSecond: null });
      continue;
    }

    let encryptMs = 0;
    let decryptMs = 0;
    try {
      for (let round = 0; round < ITERATIONS; round += 1) {
        encryptMs += pass(cipher.id, key, buffer, true);
        await yieldToLoop();
        decryptMs += pass(cipher.id, key, buffer, false);
        await yieldToLoop();
      }
    } catch (error) {
      key.fill(0);
      rows.push({ id: cipher.id, label: cipher.label, available: false, reason: error instanceof Error ? error.message : String(error), encryptMbPerSecond: null, decryptMbPerSecond: null, meanMbPerSecond: null });
      continue;
    }
    key.fill(0);

    const total = BUFFER_BYTES * ITERATIONS;
    const encrypt = megabytesPerSecond(total, encryptMs);
    const decrypt = megabytesPerSecond(total, decryptMs);
    rows.push({
      id: cipher.id,
      label: cipher.label,
      available: true,
      reason: null,
      encryptMbPerSecond: encrypt,
      decryptMbPerSecond: decrypt,
      meanMbPerSecond: megabytesPerSecond(total * 2, encryptMs + decryptMs)
    });
  }

  return {
    rows,
    bufferBytes: BUFFER_BYTES,
    iterations: ITERATIONS,
    dataUnitBytes: DATA_UNIT_BYTES,
    ranAt: new Date().toISOString()
  };
}

module.exports = { runBenchmark, BUFFER_BYTES, ITERATIONS, DATA_UNIT_BYTES };
