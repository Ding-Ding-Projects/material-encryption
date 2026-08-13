import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const benchmark = require('../src/main/benchmark.cjs');
const fmt = require('../src/main/volume-format.cjs');

// The surface this replaced quoted throughput for seven ciphers from literals in
// the source, two of which this build cannot perform at all. These assertions
// exist so a number can never again appear beside a cipher that did no work.

test('the benchmark reports the parameters its numbers were measured under', async () => {
  const result = await benchmark.runBenchmark();
  assert.equal(result.bufferBytes, benchmark.BUFFER_BYTES);
  assert.equal(result.iterations, benchmark.ITERATIONS);
  assert.equal(result.dataUnitBytes, benchmark.DATA_UNIT_BYTES);
  assert.ok(result.bufferBytes > 0 && result.iterations > 0 && result.dataUnitBytes > 0);
  // Without these a reader cannot interpret the rate at all.
  assert.ok(!Number.isNaN(Date.parse(result.ranAt)), 'ranAt must be a real timestamp');
});

test('every cipher the build can perform reports a measured rate', async () => {
  const result = await benchmark.runBenchmark();
  const available = result.rows.filter((row) => row.available);
  assert.ok(available.length >= 1, 'at least AES must be measurable');

  for (const row of available) {
    for (const field of ['encryptMbPerSecond', 'decryptMbPerSecond', 'meanMbPerSecond']) {
      assert.equal(typeof row[field], 'number', `${row.id}.${field} must be a number`);
      assert.ok(Number.isFinite(row[field]) && row[field] > 0, `${row.id}.${field} must be a real positive rate`);
    }
    assert.equal(row.reason, null, `${row.id} is available and needs no unavailability reason`);
  }
});

test('a cipher this build cannot perform never carries a number', async () => {
  const result = await benchmark.runBenchmark();
  const unavailable = result.rows.filter((row) => !row.available);
  assert.ok(unavailable.length >= 1, 'Camellia and Kuznyechik are not ported, so some rows must be unavailable');

  for (const row of unavailable) {
    // This is the whole point: a rate here would be a measurement of work that
    // never happened, which is what the replaced table did.
    assert.equal(row.encryptMbPerSecond, null, `${row.id} must not report an encrypt rate`);
    assert.equal(row.decryptMbPerSecond, null, `${row.id} must not report a decrypt rate`);
    assert.equal(row.meanMbPerSecond, null, `${row.id} must not report a mean rate`);
    assert.equal(typeof row.reason, 'string');
    assert.ok(row.reason.length > 0, `${row.id} must say why it cannot be measured`);
  }
});

test('the row set matches the engine capability report exactly', async () => {
  const result = await benchmark.runBenchmark();
  const reported = result.rows.map((row) => row.id).sort();
  const known = fmt.availableCiphers().map((entry) => entry.id).sort();
  // A cascade or cipher that is not in the engine's registry must not appear in
  // the table; the replaced version listed several that were never implemented.
  assert.deepEqual(reported, known);

  for (const row of result.rows) {
    const entry = fmt.availableCiphers().find((candidate) => candidate.id === row.id);
    assert.equal(row.available, entry.available, `${row.id} availability must match the engine`);
    if (!entry.available) assert.equal(row.reason, entry.reason, `${row.id} must carry the engine's own reason`);
  }
});
