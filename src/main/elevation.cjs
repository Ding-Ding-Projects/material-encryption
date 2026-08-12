'use strict';

// Windows elevation helper. The app drives VeraCrypt mount/unmount, which the
// VeraCrypt driver only accepts from an elevated process, so every launch
// re-launches itself elevated once. A single relaunch marker prevents a loop
// when the user declines the User Account Control prompt.

const { execFileSync, spawn } = require('node:child_process');

const RELAUNCH_FLAG = '--material-encryption-elevated';

function isElevated() {
  if (process.platform !== 'win32') return true;
  try {
    // fltmc requires administrator rights and exits non-zero without them.
    execFileSync('fltmc.exe', ['filters'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function alreadyRelaunched(argv = process.argv) {
  return argv.includes(RELAUNCH_FLAG);
}

function relaunchArguments({ isPackaged, appPath }) {
  const passthrough = process.argv.slice(1).filter((value) => value !== RELAUNCH_FLAG && !value.startsWith('--inspect'));
  const base = isPackaged ? [] : [appPath];
  return [...base, ...passthrough.filter((value) => value !== appPath), RELAUNCH_FLAG];
}

function powershellList(values) {
  if (!values.length) return null;
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(',');
}

// Returns true when an elevated instance was launched and this process should quit.
function relaunchElevated({ execPath = process.execPath, isPackaged, appPath }) {
  const args = relaunchArguments({ isPackaged, appPath });
  const list = powershellList(args);
  const command = [
    `$ErrorActionPreference='Stop'`,
    `Start-Process -FilePath '${execPath.replace(/'/g, "''")}' -Verb RunAs` + (list ? ` -ArgumentList ${list}` : '')
  ].join('; ');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 120000
    });
    return true;
  } catch (_) {
    // The user declined the elevation prompt, or the policy forbids it.
    return false;
  }
}

// Runs a command elevated without waiting for a console. Used by the VeraCrypt
// installer when the app itself is running unelevated.
function runElevated(file, args = []) {
  return new Promise((resolve, reject) => {
    const list = powershellList(args);
    const command = `$p = Start-Process -FilePath '${String(file).replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru` +
      (list ? ` -ArgumentList ${list}` : '') + '; exit $p.ExitCode';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ ok: code === 0, exitCode: code }));
  });
}

module.exports = { RELAUNCH_FLAG, isElevated, alreadyRelaunched, relaunchArguments, relaunchElevated, runElevated };
