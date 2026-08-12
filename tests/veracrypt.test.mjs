import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { validateDriveLetter, validateVolume } = require('../src/main/veracrypt.cjs');

test('drive letters are allowlisted and normalized', () => {
  assert.equal(validateDriveLetter('z:'), 'Z');
  assert.throws(() => validateDriveLetter('Z & calc'), /Select a drive letter/);
});

test('volume IDs and device paths are accepted without shell interpretation', () => {
  assert.equal(validateVolume(`ID:${'A'.repeat(64)}`), `ID:${'A'.repeat(64)}`);
  assert.equal(validateVolume('\\Device\\Harddisk1\\Partition3'), '\\Device\\Harddisk1\\Partition3');
  assert.throws(() => validateVolume('bad\npath'), /unsupported characters/);
});

test('canonical Windows volume names are accepted and malformed variants are rejected', () => {
  const canonical = '\\\\?\\Volume{5cceb196-48bf-46ab-ad00-70965512253a}\\';
  assert.equal(validateVolume(canonical), canonical);
  assert.throws(() => validateVolume('\\\\Volume{5cceb196-48bf-46ab-ad00-70965512253a}\\'), /does not exist/);
  assert.throws(() => validateVolume('\\\\?\\Volume{not-a-guid}\\'), /does not exist/);
});
