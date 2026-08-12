#!/usr/bin/env node
// Downloads the official VeraCrypt Windows package and extracts its portable
// binaries into build/veracrypt, which electron-builder ships as an extra
// resource. This is what removes the "install VeraCrypt first" dependency: the
// signed driver and executables travel inside our own installer.
//
// The download is verified against a pinned SHA-256 before anything is
// extracted. Run with --pin to record the digest of a freshly downloaded file
// after checking it against the signature published on veracrypt.fr; never pin
// a digest you have not verified against the publisher.
//
//   node scripts/fetch-veracrypt.mjs
//   node scripts/fetch-veracrypt.mjs --pin

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinPath = path.join(root, 'build', 'veracrypt-source.json');
const outputDir = path.join(root, 'build', 'veracrypt');
const cacheDir = path.join(root, 'build', '.cache');

// The executables and driver the app actually invokes. Anything else in the
// package is left behind rather than shipped for no reason.
const REQUIRED = ['VeraCrypt.exe', 'VeraCrypt Format.exe', 'veracrypt.sys', 'VeraCrypt-x64.exe', 'VeraCrypt Format-x64.exe'];
const ESSENTIAL = ['VeraCrypt.exe', 'VeraCrypt Format.exe'];

async function readPin() {
  if (!existsSync(pinPath)) {
    throw new Error(`No pinned source at ${path.relative(root, pinPath)}. Create it with { "version", "url", "sha256" } or run with --pin.`);
  }
  const pin = JSON.parse(await fs.readFile(pinPath, 'utf8'));
  for (const field of ['version', 'url', 'sha256', 'licenseUrl']) {
    if (typeof pin[field] !== 'string' || !pin[field]) throw new Error(`build/veracrypt-source.json is missing "${field}".`);
  }
  if (!/^https:\/\//i.test(pin.url)) throw new Error('The VeraCrypt source URL must be HTTPS.');
  return pin;
}

async function download(url, destination) {
  process.stdout.write(`Downloading ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 * 1024) throw new Error(`The download is only ${bytes.length} bytes; that is not the VeraCrypt package.`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return bytes;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A pinned digest only proves the download matches what we recorded. The
// Authenticode signature proves the publisher actually produced it, which is the
// check that survives a compromised pin, so it gates extraction on its own.
function verifySignature(installer) {
  // The security module does not always autoload in a constrained host, so it is
  // imported explicitly rather than left to discovery.
  const script = `Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; ` +
    `$s = Get-AuthenticodeSignature -LiteralPath '${installer.replace(/'/g, "''")}'; ` +
    `"$($s.Status)|$($s.SignerCertificate.Subject)"`;
  // PowerShell 7 is tried first: Windows PowerShell 5.1 can fail to load the
  // security module's format data in a constrained host, and that failure looks
  // identical to an unsigned file if it is not distinguished.
  let output = null;
  const failures = [];
  for (const shell of ['pwsh.exe', 'powershell.exe']) {
    try {
      output = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
      break;
    } catch (error) {
      failures.push(`${shell}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    }
  }
  if (!output) throw new Error(`Could not check the package signature, so extraction was refused.\n  ${failures.join('\n  ')}`);
  const [status, subject = ''] = output.split('|');
  if (status !== 'Valid') throw new Error(`The VeraCrypt package signature is "${status}", not Valid. Refusing to extract it.`);
  if (!/CN=IDRIX/i.test(subject)) throw new Error(`The VeraCrypt package is signed by "${subject}", not IDRIX. Refusing to extract it.`);
  process.stdout.write(`Signature valid, signed by IDRIX.\n`);
}

// The official Windows package is a self-extracting installer that supports an
// extract-only mode, so the binaries are obtained without running a setup.
// The package carries a UAC manifest, so spawning it directly fails with
// ERROR_ELEVATION_REQUIRED — which Node surfaces as EACCES, a permissions error
// that reads like a broken file rather than a missing elevation. Start-Process
// performs the elevation handshake that CreateProcess will not.
function extract(installer, destination) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const script = `$p = Start-Process -FilePath ${quote(installer)} -ArgumentList '/p','/s',${quote(`/d${destination}`)} -Wait -PassThru; exit $p.ExitCode`;
  for (const shell of ['pwsh.exe', 'powershell.exe']) {
    try {
      execFileSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        stdio: 'inherit', windowsHide: true, timeout: 10 * 60 * 1000
      });
      return;
    } catch (error) {
      if (shell === 'powershell.exe') throw new Error(`The VeraCrypt package could not be extracted: ${error.message}`);
    }
  }
}

async function main() {
  const pinning = process.argv.includes('--pin');
  const pin = await readPin();
  const installer = path.join(cacheDir, `veracrypt-${pin.version}-setup.exe`);

  let bytes;
  if (existsSync(installer)) bytes = await fs.readFile(installer);
  else bytes = await download(pin.url, installer);

  const actual = digest(bytes);
  if (pinning) {
    await fs.writeFile(pinPath, `${JSON.stringify({ ...pin, sha256: actual }, null, 2)}\n`, 'utf8');
    process.stdout.write(`Pinned sha256 ${actual}. Verify it against the publisher's signature before committing.\n`);
  } else if (actual !== pin.sha256.toLowerCase()) {
    await fs.rm(installer, { force: true });
    throw new Error(`SHA-256 mismatch. Pinned ${pin.sha256}, downloaded ${actual}. The cached download has been deleted.`);
  }

  if (process.platform !== 'win32') {
    process.stdout.write('Verified the package. Extraction needs Windows, so no binaries were written.\n');
    return;
  }

  verifySignature(installer);

  // The package refuses to extract unless its licence sits beside it, and the
  // failure is a modal dialog rather than a non-zero exit code — so a missing
  // licence looks exactly like a silent success that produced no files.
  const licensePath = path.join(cacheDir, 'License.txt');
  if (!existsSync(licensePath)) {
    const response = await fetch(pin.licenseUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Could not fetch the VeraCrypt licence: HTTP ${response.status}.`);
    const text = await response.text();
    if (!/VeraCrypt License/i.test(text)) throw new Error('The fetched licence is not the VeraCrypt licence.');
    await fs.writeFile(licensePath, text, 'utf8');
  }
  await fs.copyFile(licensePath, path.join(outputDir, '..', 'VeraCrypt-License.txt')).catch(() => {});

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  extract(installer, outputDir);

  const present = new Set(await fs.readdir(outputDir));
  const missing = ESSENTIAL.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Extraction did not produce ${missing.join(', ')}. The bundled VeraCrypt is incomplete.`);
  for (const name of present) {
    if (!REQUIRED.includes(name)) await fs.rm(path.join(outputDir, name), { recursive: true, force: true });
  }
  process.stdout.write(`Bundled VeraCrypt ${pin.version} into ${path.relative(root, outputDir)}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
