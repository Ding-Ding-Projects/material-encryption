#!/usr/bin/env node
// Guarantees node_modules/electron/dist/electron.exe exists before the app is
// started or packaged, so a fresh checkout needs nothing installed by hand.
//
// Why this exists: npm's install-script gate can leave the electron package
// present but its binary never downloaded, and electron's own install.js then
// fails in ways that look like success — it exits 0 after printing a fetch
// error, leaving no dist/ and no path.txt. Judge it only by whether the
// executable is there afterwards, never by its exit code.
//
// This helper downloads the release archive with a plain GET (some networks
// refuse the HEAD request electron's downloader issues first), verifies it
// against the checksum file shipped inside the electron package itself, and
// extracts it. It never runs when the binary is already present.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(root, 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');

const PLATFORM_EXECUTABLES = { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron' };

function log(message) { process.stdout.write(`${message}\n`); }

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function download(url, destination) {
  log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}.`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
}

function extract(archive, destination) {
  if (process.platform === 'win32') {
    const script = `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
    for (const shell of ['pwsh.exe', 'powershell.exe']) {
      try {
        execFileSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'inherit', windowsHide: true, timeout: 15 * 60 * 1000 });
        return;
      } catch (error) {
        if (shell === 'powershell.exe') throw new Error(`Could not extract the Electron archive: ${error.message}`);
      }
    }
  }
  execFileSync('unzip', ['-q', '-o', archive, '-d', destination], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
}

async function main() {
  const executableName = PLATFORM_EXECUTABLES[process.platform];
  if (!executableName) throw new Error(`No Electron executable name is known for ${process.platform}.`);
  const executable = path.join(distDir, executableName);

  if (existsSync(executable)) return;
  if (!existsSync(electronDir)) throw new Error('The electron package is not installed. Run npm install first.');

  const { version } = await readJson(path.join(electronDir, 'package.json'));
  const arch = process.arch === 'ia32' ? 'ia32' : process.arch;
  const archiveName = `electron-v${version}-${process.platform}-${arch}.zip`;
  const url = `https://github.com/electron/electron/releases/download/v${version}/${archiveName}`;
  const cache = path.join(root, 'build', '.cache', archiveName);

  log(`Electron ${version} is installed without its binary; fetching it.`);
  if (!existsSync(cache)) await download(url, cache);

  // The electron package ships the digests for its own release assets, so the
  // download is checked against the package that asked for it.
  const checksums = await readJson(path.join(electronDir, 'checksums.json'));
  const expected = checksums[archiveName];
  if (!expected) throw new Error(`${archiveName} is not listed in the electron package's checksums.json.`);
  const actual = await sha256(cache);
  // The shipped digests are base64; compare in whichever form is given.
  const expectedHex = /^[0-9a-f]{64}$/i.test(expected) ? expected.toLowerCase() : Buffer.from(expected, 'base64').toString('hex');
  if (actual !== expectedHex) {
    await fs.rm(cache, { force: true });
    throw new Error(`Electron archive checksum mismatch. Expected ${expectedHex}, got ${actual}. The download has been deleted.`);
  }

  await fs.mkdir(distDir, { recursive: true });
  extract(cache, distDir);
  if (!existsSync(executable)) throw new Error(`Extraction finished but ${executableName} is still missing.`);
  await fs.writeFile(path.join(electronDir, 'path.txt'), executableName, 'utf8');
  log(`Electron ${version} binary is ready at ${path.relative(root, executable)}.`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
