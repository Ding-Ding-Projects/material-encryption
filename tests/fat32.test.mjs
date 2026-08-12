import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../src/main/volume-engine.cjs');

const SIZE = 64 * 1024 * 1024;
const PIM = 1;
const PASSWORD = 'a container passphrase';

async function container(name, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'material-encryption-fat-'));
  const file = path.join(dir, name);
  await engine.create({ volume: file, password: PASSWORD, sizeBytes: SIZE, pim: PIM, volumeLabel: 'FILES', ...options });
  return { file, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const creds = (file) => ({ volume: file, password: PASSWORD, pim: PIM });

test('a freshly created container presents an empty, usable filesystem', async () => {
  const { file, cleanup } = await container('empty.hc');
  try {
    const listing = await engine.listFiles({ ...creds(file) });
    assert.deepEqual(listing.entries, [], 'a new container holds no files');
    assert.equal(listing.usage.label, 'FILES');
    assert.ok(listing.usage.freeBytes > 50 * 1024 * 1024, 'nearly all space is free');
    assert.equal(listing.usage.totalBytes, listing.usage.freeBytes + listing.usage.usedBytes);
  } finally {
    await cleanup();
  }
});

test('a file written into the container reads back byte-for-byte, with no driver involved', async () => {
  const { file, cleanup } = await container('files.hc');
  try {
    const payload = crypto.randomBytes(200000);
    await engine.writeFile({ ...creds(file), path: '/report.bin', contents: payload });

    const listing = await engine.listFiles({ ...creds(file) });
    assert.equal(listing.entries.length, 1);
    assert.equal(listing.entries[0].name, 'report.bin');
    assert.equal(listing.entries[0].size, payload.length);
    assert.equal(listing.entries[0].directory, false);

    const read = await engine.readFile({ ...creds(file), path: '/report.bin' });
    assert.ok(read.equals(payload), 'the file must survive the encrypted round trip exactly');
  } finally {
    await cleanup();
  }
});

test('file contents are genuinely encrypted on disk', async () => {
  const { file, cleanup } = await container('secret.hc');
  try {
    const marker = Buffer.from('THE-QUICK-BROWN-FOX-MARKER-STRING'.repeat(64), 'utf8');
    await engine.writeFile({ ...creds(file), path: '/secret.txt', contents: marker });

    const raw = await fs.readFile(file);
    assert.equal(raw.includes(Buffer.from('THE-QUICK-BROWN-FOX-MARKER-STRING')), false, 'plaintext must not appear in the container file');
    assert.equal(raw.includes(Buffer.from('secret.txt', 'utf16le')), false, 'the file name must not appear in the clear either');

    const read = await engine.readFile({ ...creds(file), path: '/secret.txt' });
    assert.ok(read.equals(marker));
  } finally {
    await cleanup();
  }
});

test('long file names survive, and so do many files in one directory', async () => {
  const { file, cleanup } = await container('names.hc');
  try {
    const longName = 'a rather long file name that needs several long-name entries.txt';
    await engine.writeFile({ ...creds(file), path: `/${longName}`, contents: Buffer.from('hello', 'utf8') });
    for (let index = 0; index < 24; index += 1) {
      await engine.writeFile({ ...creds(file), path: `/file-${index}.txt`, contents: Buffer.from(`payload ${index}`, 'utf8') });
    }

    const listing = await engine.listFiles({ ...creds(file) });
    assert.equal(listing.entries.length, 25);
    const names = listing.entries.map((entry) => entry.name);
    assert.ok(names.includes(longName), 'the long name must round-trip intact');
    assert.ok(names.includes('file-23.txt'));

    const read = await engine.readFile({ ...creds(file), path: `/${longName}` });
    assert.equal(read.toString('utf8'), 'hello');
  } finally {
    await cleanup();
  }
});

test('folders can be created and used', async () => {
  const { file, cleanup } = await container('folders.hc');
  try {
    await engine.makeDirectory({ ...creds(file), path: '/documents' });
    await engine.writeFile({ ...creds(file), path: '/documents/note.txt', contents: Buffer.from('inside a folder', 'utf8') });

    const root = await engine.listFiles({ ...creds(file) });
    const folder = root.entries.find((entry) => entry.name === 'documents');
    assert.ok(folder, 'the folder must appear in the root');
    assert.equal(folder.directory, true);

    const inner = await engine.listFiles({ ...creds(file), path: '/documents' });
    assert.equal(inner.entries.length, 1);
    assert.equal(inner.entries[0].name, 'note.txt');

    const read = await engine.readFile({ ...creds(file), path: '/documents/note.txt' });
    assert.equal(read.toString('utf8'), 'inside a folder');
  } finally {
    await cleanup();
  }
});

test('deleting a file frees its space and overwriting reuses it', async () => {
  const { file, cleanup } = await container('churn.hc');
  try {
    const before = (await engine.listFiles({ ...creds(file) })).usage.freeBytes;
    await engine.writeFile({ ...creds(file), path: '/big.bin', contents: crypto.randomBytes(2 * 1024 * 1024) });
    const during = (await engine.listFiles({ ...creds(file) })).usage.freeBytes;
    assert.ok(during < before, 'writing must consume space');

    await engine.deleteFile({ ...creds(file), path: '/big.bin' });
    const after = (await engine.listFiles({ ...creds(file) })).usage.freeBytes;
    assert.equal(after, before, 'deleting must return exactly the space it took');
    assert.deepEqual((await engine.listFiles({ ...creds(file) })).entries, []);

    // Overwriting an existing name must not leak the old chain.
    await engine.writeFile({ ...creds(file), path: '/same.bin', contents: crypto.randomBytes(1024 * 1024) });
    const firstWrite = (await engine.listFiles({ ...creds(file) })).usage.freeBytes;
    await engine.writeFile({ ...creds(file), path: '/same.bin', contents: crypto.randomBytes(1024 * 1024) });
    const secondWrite = (await engine.listFiles({ ...creds(file) })).usage.freeBytes;
    assert.equal(secondWrite, firstWrite, 'overwriting must not consume space twice');
    assert.equal((await engine.listFiles({ ...creds(file) })).entries.length, 1);
  } finally {
    await cleanup();
  }
});

test('the filesystem is reachable through a Serpent container too', async () => {
  const { file, cleanup } = await container('serpent-files.hc', { cipher: 'Serpent' });
  try {
    await engine.writeFile({ ...creds(file), path: '/ported.txt', contents: Buffer.from('ported cipher, ported filesystem', 'utf8') });
    const read = await engine.readFile({ ...creds(file), path: '/ported.txt' });
    assert.equal(read.toString('utf8'), 'ported cipher, ported filesystem');
  } finally {
    await cleanup();
  }
});

test('the wrong password cannot reach the filesystem, and reads are refused past the data area', async () => {
  const { file, cleanup } = await container('guarded.hc');
  try {
    await assert.rejects(engine.listFiles({ volume: file, password: 'not the passphrase', pim: PIM }), /Incorrect password/);
    await assert.rejects(engine.readFile({ ...creds(file), path: '/missing.txt' }), /no file named/);
    await assert.rejects(engine.listFiles({ ...creds(file), path: '/nowhere' }), /no folder named/);
  } finally {
    await cleanup();
  }
});
