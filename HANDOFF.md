# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`. Its main-process adapter invokes a separately installed VeraCrypt executable through validated, allowlisted operations. VeraCrypt owns password entry and all cryptography.

The current unreleased tree expands the application to 14 destinations. It adds a categorized local File Converter with PDF tooling and a persistent bounded-concurrency queue, plus Ollama Studio for local runtime discovery, official model/tag inventory, evidence-based PC fit, model downloads, chat, reviewed harness profiles, configuration snapshots, rollback, and restore.

## Implemented source inventory

- `scripts/verify-design-coverage.mjs` hand-lists all 14 destinations: Volumes, Favorite Volumes, Volume Creation Wizard, Volume Properties, Security, Performance & Tools, File Converter, Ollama Studio, Preferences, History, Locked surfaces, Authenticator, Support Tickets, and Settings.
- `src/main/file-converter.cjs` owns the eight-category registry, converter adapters, PDF operations, atomic output validation, and persistent queue. The queue accepts incremental file and folder intake, allows 1–8 workers, uses 2 in the application, and caps persisted state at 100,000 jobs.
- `src/main/ollama-manager.cjs` owns the fixed loopback Ollama API boundary, official registry pagination/cache, hardware inventory and fit evaluation, pull/chat streaming, reviewed runtime profiles, snapshots, rollback, restore, and bounded chat metadata history.
- `src/main/main.cjs` and `src/main/preload.cjs` expose constrained converter and Ollama IPC methods rather than arbitrary paths, URLs, commands, or shell input.
- `design/VeraCrypt Material.dc.html` supplies the 14-destination user interface, categorized converter, PDF and queue controls, Ollama runtime/catalog/cart/chat/harness/recovery surfaces, and original/customizable application logo.

## Current local-check boundary

The test source contains 42 Node tests:

| Test file | Tests |
|---|---:|
| `tests/veracrypt.test.mjs` | 3 |
| `tests/totp.test.mjs` | 3 |
| `tests/file-converter.test.mjs` | 10 |
| `tests/converter-bridge-contract.test.mjs` | 5 |
| `tests/pdf-tools.test.mjs` | 10 |
| `tests/ollama-manager.test.mjs` | 10 |
| **Total** | **41** |

This is an inventory of current test cases, not a claim that the final integrated candidate has completed every local check. The final shutdown pass must run `npm run test:all`, packaging, runtime interaction/capture, executable-icon verification, and installer verification at the exact candidate commit.

## Capture and release status

The checked-in `docs/assets/runtime` directory contains the previous 24-state packaged baseline. Its manifest covers the earlier 13 destinations and does not include Ollama Studio. Those existing files may illustrate already captured surfaces, but they do not prove the final current candidate.

No new release, current installer, current complete capture matrix, hosted-site update, or remote CI result is claimed here. The next owner must:

1. integrate all source and documentation changes;
2. run the complete local suite and record the exact result;
3. package the application and capture all 14 destinations, including Ollama Studio, through the isolated hidden-desktop route;
4. build and verify the unsigned Squirrel.Windows artifacts;
5. publish and verify the exact final commit, unique release, assets, timing, line evidence, and documentation site.

## Previous published baseline

Release `v0.1.2` targeted commit `f649cf6c9e3239bf128fcc4292da90ee952eed05`. That historical release remains the latest published baseline until a newer release is independently verified. Its evidence must not be reused as proof for the current unreleased source.
