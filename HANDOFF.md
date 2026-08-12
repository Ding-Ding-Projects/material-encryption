# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`. Its main-process adapter controls the locally installed VeraCrypt executable through validated, allowlisted operations. VeraCrypt owns password entry and all cryptography.

## Verification

- `npm run test:all`: 6/6 Node tests plus design, security, and workflow contract checks passed.
- Packaged renderer: launched on an isolated hidden Windows desktop and captured through its single CDP page.
- Local installer: unsigned Squirrel.Windows setup, `RELEASES`, and full package verified.
- `build.bat /s` and `build-installer.bat /s` remain the supported local build and packaging paths.

## Remaining release work

Release `v0.1.2` was published from `f649cf6c9e3239bf128fcc4292da90ee952eed05` by run `31562209421`. The release tag targets that exact commit and its four assets are uploaded: unsigned setup, `RELEASES`, full package, and build evidence. The setup asset is 149,266,432 bytes with SHA-256 `08727AEB22683688457BF99EF0B2212E7D684482BBCABCB7853A2C9EC8843F77`.

The original release notes were corrected after verification found PowerShell interpolation control characters. The release body now records the exact target SHA, asset hash, `NotSigned` state, job-to-publication duration, line-count table, and local-only test boundary. The next workflow revision creates a private draft, fills its notes through the numeric release ID, publishes once, replaces the two timing placeholders from authoritative `publishedAt`, and fails unless the public read-back is complete and free of control characters or unresolved placeholders.

GitHub Pages deployment run `31562252019` is green at `f649cf6c9e3239bf128fcc4292da90ee952eed05`; the public home and security article return HTTP 200. The repository inventory has one primary checkout, local `main`, remote `main`, no additional branches, no stashes, and no linked worktrees. Published release tags are retained as immutable delivery history.
