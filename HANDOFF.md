# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`. Its main-process adapter controls the locally installed VeraCrypt executable through validated, allowlisted operations. VeraCrypt owns password entry and all cryptography.

## Verification

- `npm run test:all`: 6/6 Node tests plus design, security, and workflow contract checks passed.
- Packaged renderer: launched on an isolated hidden Windows desktop and captured through its single CDP page.
- Local installer: unsigned Squirrel.Windows setup, `RELEASES`, and full package verified.
- `build.bat /s` and `build-installer.bat /s` remain the supported local build and packaging paths.

## Remaining release work

Remote run `31561973251` built successfully but its evidence collection failed because the setup filename glob expected `*Setup.exe`; the follow-up commit accepts the configured `Setup-<version>-<arch>.exe` shape. First-release publication, remote asset verification, and the final cleanup audit remain pending.
