// Hand-written inventory of every gate this project must run before a release,
// and of every canonical capability that must have an owner in the tree.
//
// The point of writing it by hand is that a rule which only validates what it
// discovers cannot notice something that disappeared entirely. A guard built by
// scanning the tests directory passes cheerfully on a repository whose tests
// were all deleted. Every row below therefore names its evidence explicitly, and
// a missing file, a missing npm script, or a capability with no implementation
// fails this check.
//
// Adding a feature means adding its row here. That is deliberate friction.

import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const failures = [];
const checked = [];

async function exists(relative) {
  try {
    await access(path.join(root, relative), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// --- gate commands -------------------------------------------------------
// Each row: the npm script that runs it, what it covers, and the committed file
// that proves the script has something real to run.
const GATES = [
  { command: 'test', scope: 'Node unit and contract suites', evidence: 'tests/volume-engine.test.mjs' },
  { command: 'test:brand', scope: 'logo master, renderer assets, multi-size ICO', evidence: 'scripts/verify-brand-assets.mjs' },
  { command: 'test:design', scope: 'designed destinations present in the production renderer', evidence: 'scripts/verify-design-coverage.mjs' },
  { command: 'test:security', scope: 'renderer isolation, local assets, secret-safe invocation', evidence: 'scripts/verify-security-contract.mjs' },
  { command: 'test:workflow', scope: 'workflow dependency inventory and bootstrap path', evidence: 'scripts/verify-workflow-inventory.mjs' },
  { command: 'test:package', scope: 'unsigned Squirrel.Windows packaging contract', evidence: 'scripts/verify-package-manifest.mjs' },
  { command: 'test:all', scope: 'every gate above in one command', evidence: 'package.json' },
  { command: 'count:lines', scope: 'line-count evidence published with each release', evidence: 'scripts/count-lines.mjs' },
  { command: 'capture:matrix', scope: 'packaged runtime capture matrix', evidence: 'scripts/capture-matrix.mjs' },
  { command: 'capture:runtime', scope: 'single packaged runtime state capture', evidence: 'scripts/capture-runtime.mjs' },
  { command: 'dist', scope: 'real installable Squirrel.Windows artifacts', evidence: 'scripts/apply-packaged-icon.cjs' },
  { command: 'build:driver', scope: 'kernel driver built and verified from source', evidence: 'scripts/build-driver.ps1' },
  { command: 'ensure:electron', scope: 'electron binary present before start or package', evidence: 'scripts/ensure-electron-binary.mjs' },
  { command: 'prepare:renderer', scope: 'production renderer generated from the design source', evidence: 'scripts/prepare-renderer.mjs' }
];

// --- test suites ---------------------------------------------------------
const SUITES = [
  { file: 'tests/volume-engine.test.mjs', scope: 'volume header format, container create/open/re-key/restore' },
  { file: 'tests/crypto-ciphers.test.mjs', scope: 'ported Serpent and Twofish against upstream vectors, XTS vs native' },
  { file: 'tests/fat32.test.mjs', scope: 'files inside a container without a drive letter' },
  { file: 'tests/veracrypt.test.mjs', scope: 'drive enumeration and allowlisted invocation' },
  { file: 'tests/totp.test.mjs', scope: 'authenticator' },
  { file: 'tests/logo-service.test.mjs', scope: 'app-logo customization' },
  { file: 'tests/file-converter.test.mjs', scope: 'file converter' },
  { file: 'tests/pdf-tools.test.mjs', scope: 'PDF operations' },
  { file: 'tests/converter-bridge-contract.test.mjs', scope: 'converter IPC contract' },
  { file: 'tests/ollama-manager.test.mjs', scope: 'Ollama suite manager' },
  { file: 'tests/ollama-bridge-contract.test.mjs', scope: 'Ollama IPC contract' }
];

// --- canonical capabilities ----------------------------------------------
// Each capability names the module that owns it. A capability whose owner is
// gone fails here even if every test that remains still passes.
const CAPABILITIES = [
  { name: 'Volume header format', owner: 'src/main/volume-format.cjs', symbol: 'tryDecryptHeader' },
  { name: 'Container engine', owner: 'src/main/volume-engine.cjs', symbol: 'changePassword' },
  { name: 'FAT32 inside a container', owner: 'src/main/fat32.cjs', symbol: 'createVolume' },
  { name: 'Serpent cipher', owner: 'src/main/crypto/serpent.cjs', symbol: 'createCipher' },
  { name: 'Twofish cipher', owner: 'src/main/crypto/twofish.cjs', symbol: 'createCipher' },
  { name: 'XTS mode', owner: 'src/main/crypto/xts.cjs', symbol: 'createXts' },
  { name: 'Elevation handling', owner: 'src/main/elevation.cjs', symbol: 'relaunchElevated' },
  { name: 'Drive enumeration', owner: 'src/main/veracrypt.cjs', symbol: 'listDrives' },
  { name: 'Credential store and toy locks', owner: 'src/main/credential-store.cjs', symbol: 'createLock' },
  { name: 'File converter', owner: 'src/main/file-converter.cjs', symbol: 'createConverterService' },
  { name: 'Ollama suite manager', owner: 'src/main/ollama-manager.cjs', symbol: 'createOllamaManager' },
  { name: 'App-logo customization', owner: 'src/main/logo-service.cjs', symbol: 'createLogoService' },
  { name: 'Authenticator', owner: 'src/main/totp.cjs', symbol: 'totp' }
];

const manifestPath = 'docs/assets/runtime/capture-manifest.json';

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

for (const gate of GATES) {
  if (!packageJson.scripts?.[gate.command]) {
    failures.push(`Gate "${gate.command}" (${gate.scope}) has no npm script.`);
    continue;
  }
  if (!(await exists(gate.evidence))) {
    failures.push(`Gate "${gate.command}" names evidence ${gate.evidence}, which does not exist.`);
    continue;
  }
  checked.push(gate.command);
}

for (const suite of SUITES) {
  if (!(await exists(suite.file))) {
    failures.push(`Suite ${suite.file} (${suite.scope}) is missing.`);
    continue;
  }
  const body = await readFile(path.join(root, suite.file), 'utf8');
  // A suite file that exists but asserts nothing is not a suite.
  if (!/\bassert\b/.test(body) || !/\btest\(/.test(body)) {
    failures.push(`Suite ${suite.file} contains no test with an assertion.`);
    continue;
  }
  checked.push(suite.file);
}

for (const capability of CAPABILITIES) {
  if (!(await exists(capability.owner))) {
    failures.push(`Capability "${capability.name}" has no implementation at ${capability.owner}.`);
    continue;
  }
  // Searching the source text for the symbol is not enough: renaming the
  // definition leaves the old name in the export list, so a grep-style check
  // passes on a module that no longer defines it. Loading the module and asking
  // for the function cannot be fooled that way, and it also catches a file that
  // has been broken outright.
  let owned;
  try {
    owned = require(path.join(root, capability.owner));
  } catch (error) {
    failures.push(`Capability "${capability.name}" could not be loaded from ${capability.owner}: ${error.message}`);
    continue;
  }
  if (typeof owned?.[capability.symbol] !== 'function') {
    failures.push(`Capability "${capability.name}" no longer exports ${capability.symbol}() from ${capability.owner}.`);
    continue;
  }
  checked.push(capability.name);
}

if (!(await exists(manifestPath))) {
  failures.push(`The packaged capture manifest ${manifestPath} is missing.`);
} else {
  const manifest = JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
  if (!Number.isInteger(manifest.stateCount) || manifest.stateCount < 36) {
    failures.push(`The capture manifest records ${manifest.stateCount} states; at least 36 are required.`);
  } else {
    checked.push(`capture manifest (${manifest.stateCount} states)`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL: ${failure}\n`);
  process.stderr.write(`\n${failures.length} inventory row(s) failed.\n`);
  process.exit(1);
}

process.stdout.write(`PASS: ${GATES.length} gates, ${SUITES.length} suites and ${CAPABILITIES.length} capabilities are present with their evidence.\n`);
