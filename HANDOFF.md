# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`. Its main-process adapter controls the locally installed VeraCrypt executable through validated, allowlisted operations. VeraCrypt owns password entry and all cryptography.

## Verification

- `npm run test:design` checks the 12 designed destinations in the production renderer.
- `npm run test:security` checks isolation, local assets, and the password-argument prohibition.
- `npm test` covers drive-letter and volume-identifier validation.
- `build.bat /s` and `build-installer.bat /s` are the supported local build and packaging paths.

## Remaining release work

The packaged app still needs isolated headless runtime interaction, a real capture matrix, unsigned Squirrel artifact verification, the release workflow, and first-release publication. This section must be replaced with exact commit, run, release, asset, and hash evidence after those steps finish.
