'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function applyPackagedIcon(context) {
  if (context.electronPlatformName !== 'win32') return;
  const root = context.packager.projectDir;
  const editor = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
  const icon = path.join(root, 'build', 'material-encryption.ico');
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  for (const [label, file] of [['resource editor', editor], ['brand icon', icon], ['packaged executable', executable]]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  }
  execFileSync(editor, [executable, '--set-icon', icon], { windowsHide: true, stdio: 'inherit' });
  console.log(`Applied the verified application icon to ${path.basename(executable)} without signing.`);
};
