import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pngPaths = [
  ['design master', 'design/material-encryption-logo-master.png', 1024],
  ['design logo', 'design/assets/material-encryption-logo.png', 512],
  ['renderer logo', 'src/renderer/assets/material-encryption-logo.png', 256]
];

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature is invalid');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

for (const [label, file, minimum] of pngPaths) {
  const bytes = await readFile(file);
  const [width, height] = pngDimensions(bytes);
  assert.equal(width, height, `${label} must remain square`);
  assert.ok(width >= minimum, `${label} must be at least ${minimum}px`);
}

const icon = await readFile('build/material-encryption.ico');
assert.equal(icon.readUInt16LE(0), 0, 'ICO reserved header must be zero');
assert.equal(icon.readUInt16LE(2), 1, 'Brand container must be an ICO');
const count = icon.readUInt16LE(4);
assert.ok(count >= 9, 'Brand ICO must contain the complete nine-size set');
const sizes = new Set();
for (let index = 0; index < count; index += 1) {
  const offset = 6 + index * 16;
  const width = icon[offset] || 256;
  const height = icon[offset + 1] || 256;
  assert.equal(width, height, 'Every ICO frame must be square');
  const byteLength = icon.readUInt32LE(offset + 8);
  const imageOffset = icon.readUInt32LE(offset + 12);
  assert.ok(byteLength > 0 && imageOffset + byteLength <= icon.length, 'ICO frame points outside its container');
  sizes.add(width);
}
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) assert.ok(sizes.has(size), `ICO is missing ${size}px`);

console.log(`PASS: brand master, renderer assets, and ${sizes.size}-size ICO are valid.`);
