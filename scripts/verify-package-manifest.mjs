import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const versionParts = String(manifest.version).split('.').map(Number);

assert.equal(versionParts.length, 3, 'The package version must be a three-part semantic version.');
assert.ok(versionParts.every(Number.isInteger), 'The package version must contain only integer parts.');
assert.ok(
  versionParts[0] > 0 || versionParts[1] > 1 || (versionParts[1] === 1 && versionParts[2] > 8),
  'The Squirrel.Windows package version must be newer than the published 0.1.8 baseline.',
);
assert.equal(lock.version, manifest.version, 'package-lock.json must match package.json.');
assert.equal(lock.packages?.['']?.version, manifest.version, 'The lockfile root package version must match package.json.');
assert.equal(manifest.build?.forceCodeSigning, false, 'Signing discovery must stay disabled.');
assert.equal(manifest.build?.win?.forceCodeSigning, false, 'Windows signing discovery must stay disabled.');
assert.equal(manifest.build?.win?.signExecutable, false, 'Executable signing must stay disabled.');
assert.equal(manifest.build?.win?.signAndEditExecutable, false, 'Signer-backed executable editing must stay disabled.');
assert.equal(manifest.build?.squirrelWindows?.msi, false, 'The release contract publishes Squirrel setup and update files, not MSI.');
assert.equal(manifest.build?.squirrelWindows?.artifactName, 'MaterialEncryption-Setup-${version}-${arch}.${ext}');
assert.equal(manifest.build?.squirrelWindows?.remoteReleases, 'https://github.com/Ding-Ding-Projects/material-encryption', 'The release contract must use the fixed public update feed so a clean runner can produce the generated delta package.');
assert.equal(manifest.scripts?.['dist:unsigned'], 'electron-builder --win squirrel --x64');
assert.ok(!/test|lint/i.test(manifest.scripts['dist:unsigned']), 'The workflow packaging primitive must not run tests or lint.');
assert.match(manifest.scripts?.dist || '', /npm run dist:unsigned/, 'The local dist command must delegate to the reviewed unsigned primitive.');

console.log(`PASS: package ${manifest.version} is newer than 0.1.8 and keeps the reviewed unsigned Squirrel.Windows contract.`);
