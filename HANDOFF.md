# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`.

As of 0.1.10 the application performs its own cryptography. `src/main/volume-format.cjs` and `src/main/volume-engine.cjs` implement the VeraCrypt volume header and data area directly, `src/main/crypto/` holds the ported Serpent and Twofish ciphers plus an XTS implementation, and `src/main/fat32.cjs` reads and writes the filesystem inside a container. Creating, opening, verifying, re-keying, repairing and browsing a container require nothing to be installed.

One capability is not implemented in user space: assigning a drive letter needs a kernel-mode filesystem driver, and Windows will not load an unsigned one. `scripts/build-driver.ps1` builds that driver from the VeraCrypt source and verifies the artifact, but loading it requires the machine's owner to disable driver signature enforcement themselves. The application detects an installed VeraCrypt for mounting and says plainly when it is absent; it never installs anything.

Package 0.1.9 expanded the application to 14 destinations. It adds a categorized local File Converter with PDF tooling and a persistent bounded-concurrency queue, plus Ollama Studio for local runtime discovery, official model/tag inventory, evidence-based PC fit, model downloads, chat, reviewed harness profiles, configuration snapshots, rollback, and restore.

## Implemented source inventory

- `scripts/verify-design-coverage.mjs` hand-lists all 14 destinations: Volumes, Favorite Volumes, Volume Creation Wizard, Volume Properties, Security, Performance & Tools, File Converter, Ollama Studio, Preferences, History, Locked surfaces, Authenticator, Support Tickets, and Settings.
- `src/main/file-converter.cjs` owns the eight-category registry, converter adapters, PDF operations, atomic output validation, and persistent queue. The queue accepts incremental file and folder intake, allows 1–8 workers, uses 2 in the application, and caps persisted state at 100,000 jobs.
- `src/main/ollama-manager.cjs` owns the fixed loopback Ollama API boundary, official registry pagination/cache, hardware inventory and fit evaluation, pull progress and complete-response chat, reviewed runtime profiles, snapshots, rollback, restore, and bounded chat metadata history.
- `src/main/main.cjs` and `src/main/preload.cjs` expose constrained converter and Ollama IPC methods rather than arbitrary paths, URLs, commands, or shell input.
- `design/VeraCrypt Material.dc.html` supplies the 14-destination user interface, categorized converter, PDF and queue controls, Ollama runtime/catalog/cart/chat/harness/recovery surfaces, and original/customizable application logo.

## Current local-check boundary

The integrated package `0.1.9` has 55 passing Node tests:

| Test file | Tests |
|---|---:|
| `tests/veracrypt.test.mjs` | 3 |
| `tests/totp.test.mjs` | 3 |
| `tests/logo-service.test.mjs` | 5 |
| `tests/file-converter.test.mjs` | 10 |
| `tests/converter-bridge-contract.test.mjs` | 6 |
| `tests/pdf-tools.test.mjs` | 10 |
| `tests/ollama-manager.test.mjs` | 13 |
| `tests/ollama-bridge-contract.test.mjs` | 5 |
| **Total** | **55** |

`npm test` completed with 55/55 passing, and `npm run test:all` is green. These are local checks; they do not substitute for installer or hosted-release verification.

## Capture and release status

The checked-in `docs/assets/runtime/capture-manifest.json` is dated `2026-08-12` and records 36 states covering all 14 destinations: 24 packaged UI interactions, one actual bridge/runtime observation (healthy local Ollama `v0.32.9`), and 11 seeded visual fixtures. The fixture images are renderer-only evidence and do not prove live conversion, model catalog/download, chat, harness, restore, or Ollama-service behaviour.

No current installer, new release, hosted-site update, or remote CI result is claimed here. The next owner must:

1. integrate all source and documentation changes;
2. package the application and, if the capture matrix changes, refresh all 14 destinations through the isolated hidden-desktop route while preserving the fixture evidence boundary;
4. build and verify the unsigned Squirrel.Windows artifacts;
5. publish and verify the exact final commit, unique release, assets, timing, line evidence, and documentation site.

## Previous published baseline

Release `v0.1.2` targeted commit `f649cf6c9e3239bf128fcc4292da90ee952eed05`. That historical release remains the latest published baseline until a newer release is independently verified. Its evidence is not reused as proof for package 0.1.9.
