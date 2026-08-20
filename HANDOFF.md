# Handoff

## Current scope

Material Encryption is an independent Windows Electron interface generated from the full design export in `design/`.

As of 0.1.10 the application performs its own cryptography. `src/main/volume-format.cjs` and `src/main/volume-engine.cjs` implement the VeraCrypt volume header and data area directly, `src/main/crypto/` holds the ported Serpent and Twofish ciphers plus an XTS implementation, and `src/main/fat32.cjs` reads and writes the filesystem inside a container. Creating, opening, verifying, re-keying, repairing and browsing a container require nothing to be installed.

One capability is not implemented in user space: assigning a drive letter needs a kernel-mode filesystem driver, and Windows will not load an unsigned one. `scripts/build-driver.ps1` builds that driver from the VeraCrypt source and verifies the artifact, but loading it requires the machine's owner to disable driver signature enforcement themselves. The application detects an installed VeraCrypt for mounting and says plainly when it is absent; it never installs anything.

Package 0.1.9 expanded the application to 14 destinations, adding a categorized local File Converter with PDF tooling and a persistent bounded-concurrency queue, plus Ollama Studio. Package 0.1.10 replaced the surfaces that were still showing prototype data with real ones: the Volumes table reads live drive letters, the Volume Creation Wizard creates containers with measured progress, Performance & Tools measures throughput instead of quoting it, and Volume Properties reads the engine's own header.

## Implemented source inventory

- `scripts/verify-design-coverage.mjs` hand-lists all 14 destinations: Volumes, Favorite Volumes, Volume Creation Wizard, Volume Properties, Security, Performance & Tools, File Converter, Ollama Studio, Preferences, History, Locked surfaces, Authenticator, Support Tickets, and Settings.
- `src/main/file-converter.cjs` owns the eight-category registry, converter adapters, PDF operations, atomic output validation, and persistent queue. The queue accepts incremental file and folder intake, allows 1–8 workers, uses 2 in the application, and caps persisted state at 100,000 jobs.
- `src/main/ollama-manager.cjs` owns the fixed loopback Ollama API boundary, official registry pagination/cache, hardware inventory and fit evaluation, pull progress and complete-response chat, reviewed runtime profiles, snapshots, rollback, restore, and bounded chat metadata history.
- `src/main/main.cjs` and `src/main/preload.cjs` expose constrained converter and Ollama IPC methods rather than arbitrary paths, URLs, commands, or shell input.
- `design/VeraCrypt Material.dc.html` supplies the 14-destination user interface, categorized converter, PDF and queue controls, Ollama runtime/catalog/cart/chat/harness/recovery surfaces, and original/customizable application logo.

## Current local-check boundary

The integrated package `0.1.10` has 87 passing Node tests:

| Test file | Tests |
|---|---:|
| `tests/volume-engine.test.mjs` | 10 |
| `tests/crypto-ciphers.test.mjs` | 10 |
| `tests/fat32.test.mjs` | 8 |
| `tests/file-converter.test.mjs` | 10 |
| `tests/pdf-tools.test.mjs` | 10 |
| `tests/ollama-manager.test.mjs` | 13 |
| `tests/converter-bridge-contract.test.mjs` | 7 |
| `tests/logo-service.test.mjs` | 6 |
| `tests/benchmark.test.mjs` | 4 |
| `tests/veracrypt.test.mjs` | 3 |
| `tests/totp.test.mjs` | 3 |
| `tests/ollama-bridge-contract.test.mjs` | 3 |
| **Total** | **87** |

`npm run test:all` is green across brand, design coverage, security, workflow, packaging and the hand-written completeness inventory (16 gates, 12 suites, 14 capabilities).

## Runtime verification, and why it is separate

Node links OpenSSL; the packaged application links Electron's BoringSSL, which provides no XTS cipher at all. A suite that runs only under Node cannot see that difference, and every AES container was briefly unopenable in the shipped build while all tests passed. Unit tests are therefore not evidence about the packaged artifact, and three checks are run against the built application instead:

- `npm run verify:wizard` — drives the Volume Creation Wizard with real mouse and keyboard events through the debugging protocol, types every value, presses Create, and reads the result back with the engine. 22 checks.
- The engine end-to-end pass — create, open, wrong-password refusal, folder creation, re-key with data intact, backup-header recovery, and absence of plaintext on disk. 14 checks.
- The lane pass — benchmark measurement, null rates for unavailable ciphers, wizard capability source, and absence of the previously fabricated values in the live DOM. 4 checks.

Synthetic DOM events do not work against this renderer: a dispatched `.click()` and a directly assigned input value are both ignored, so a harness built on them presses nothing while reporting success. Use the debugging protocol's input domain.

## Capture and release status

`docs/assets/runtime/capture-manifest.json` records 36 states covering all 14 destinations, regenerated from the packaged build at the released commit: 24 packaged UI interactions, one actual bridge/runtime observation, and 11 seeded visual fixtures. The fixture images are renderer-only evidence and do not prove live conversion, model catalog/download, chat, harness, restore, or Ollama-service behaviour.

## Published baseline

Release `v0.1.10-build.24` targets commit `31e81162e4108aabab51786cbadccc4f3a7bfbbd`, is non-draft, and carries the unsigned installer, the full update package, `RELEASES`, build evidence and the required catalog image. The installer was downloaded and its SHA-256 compared against the release notes: `6044BEE11B52DC438EBA896B0A4ECD9D5613F0A0CD485D5E956ABC722EC84CEF`, matching, and reporting `NotSigned` as the permanent no-signing policy requires. Remote CI for that commit is green.

## Known boundaries for the next owner

- Assigning a drive letter needs a loaded kernel driver. `scripts/build-driver.ps1` builds one from source and verifies it, but Windows will not load it until the machine's owner disables driver signature enforcement themselves. Nothing in this project does that, and the user-mode side that would drive the driver over `DeviceIoControl` is not built; it needs a native addon.
- Camellia and Kuznyechik are not ported. They are reported as unavailable with a reason and never silently substituted.
- Favorites, History and notifications render empty rather than fabricated. They are unimplemented, not broken.
- Squirrel packaging previously failed about half the time inside its bundled 7-Zip; the cause was the `remoteReleases` delta sync corrupting the full package, and removing it fixed the build at the cost of the delta package. Tracked as issue #6.

## Windows PowerShell verifier repair

The unsigned-installer, Squirrel release-linkage, and packaged-icon helpers now import the inbox
Windows PowerShell Utility and Security manifests from their exact `System32` locations. This fixes
the inherited-`PSModulePath` case where a PowerShell 7 parent made Windows PowerShell resolve an
incompatible Core-edition module and then report `Get-FileHash` as unavailable. The repair changes
no persistent execution policy, module installation, signing setting, artifact name, or package
contents. `scripts/verify-package-manifest.mjs` fails when any of the three verifiers loses the
pinned bootstrap.
