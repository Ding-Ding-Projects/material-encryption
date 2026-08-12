# Complete local suite inventory

Every command below belongs in the final release-shutdown pass. The evidence column describes what the command is intended to establish; it is not a claim that the final integrated candidate has already run it.

| Scope | Command | Current source inventory or required evidence |
|---|---|---|
| Brand source and ICO frames | `npm run test:brand` | Original master/renderer PNGs and nine ICO sizes; must pass at final commit |
| Design compile and destinations | `npm run test:design` | JavaScript compile plus 14 hand-listed destinations, including Ollama Studio |
| Renderer and process security | `npm run test:security` | CSP, isolation, local assets, and secret-safe invocation contract |
| Workflow bootstrap inventory | `npm run test:workflow` | Release job and explicit dependency inventory |
| Package manifest | `npm run test:package` | Version newer than `0.1.8`, lockfile parity, unsigned Squirrel settings, and packaging-only workflow primitive |
| Node unit suite | `npm test` | 55/55 passing tests across eight files |
| Complete source suite | `npm run test:all` | Runs brand, design, security, workflow, and Node test commands in sequence |
| Line evidence | `npm run count:lines` | Committed counter only; publish only the table produced at the release commit |
| Unpacked package | `npm run package` | Real packaged `resources/app.asar` from the candidate commit |
| Executable identity | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-packaged-icon.ps1 -Executable 'dist\win-unpacked\Material Encryption.exe'` | Extracted icon, executable hash, and unsigned state |
| Runtime smoke and capture | `npm run capture:matrix -- --port=<isolated-port>` | Must be refreshed to cover all 14 destinations, including Ollama Studio, plus required semantic states |
| Installer | `build-installer.bat /s` | Exact versioned Squirrel.Windows setup, full and generated delta package names, `RELEASES` SHA-1/byte-length linkage, source commit, hash, and unsigned state |

## Node test breakdown

| File | Declared tests | Coverage focus |
|---|---:|---|
| `tests/veracrypt.test.mjs` | 3 | Drive and volume identifier allowlists |
| `tests/totp.test.mjs` | 3 | Base32, RFC 6238 vectors, and bounded parameters |
| `tests/file-converter.test.mjs` | 10 | Detection, adapters, byte bounds, destinations, capabilities, and partial batches |
| `tests/converter-bridge-contract.test.mjs` | 5 | Preload/main queue and PDF seams, stored-state validation, registry categories, and plan bounds |
| `tests/pdf-tools.test.mjs` | 10 | Bundled/offline registry, all PDF operations, reopened validation, atomic writes, persistent queue, and folder rules |
| `tests/ollama-manager.test.mjs` | 13 | Loopback API, bounded complete responses, cancellation, cart, catalog pagination/cache, PC fit, harness rollback/restore, and bounded history metadata |
| `tests/ollama-bridge-contract.test.mjs` | 5 | Ollama bridge operation identifiers, cancellation, and complete-response contract |
| **Total** | **55** | `npm test` verified 55/55; `npm run test:all` is green |

## Runtime evidence requirements

The runtime matrix must use the approved hidden-desktop path, preflight exactly one packaged renderer CDP page, reload between states, assert semantic headings, verify the loaded logo, prove the light computed role, and reject horizontal page overflow at 390 × 844.

The checked-in manifest dated `2026-08-12` contains 36 states across all 14 destinations: 24 packaged UI interactions, one actual bridge/runtime observation (healthy local Ollama `v0.32.9`), and 11 seeded visual fixtures. Fixtures are clearly labelled and must not be counted as live conversion, model, download, chat, harness, restore, or Ollama-service proof.

## Suggested articles

- [Build and release](README.md)
- [Application logo](../design/app-logo.md)
- [Local File Converter](../tools/file-converter.md)
- [Ollama Studio](../ollama/ollama-studio.md)
