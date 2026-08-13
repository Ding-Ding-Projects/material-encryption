# Changelog

## 0.1.10

### Cryptography is now performed by this application

- Added `src/main/volume-format.cjs` and `src/main/volume-engine.cjs`, which implement the VeraCrypt volume header directly: PBKDF2 header keys, XTS, both CRC-32 fields, the primary and backup headers, and the documented non-system iteration rules. Header offsets and iteration counts were checked against the upstream source at tag `VeraCrypt_1.26.29` rather than from memory.
- Creating, opening, verifying, re-keying, backing up and restoring a container no longer involve VeraCrypt or any other external program.
- A new container is formatted FAT32 as it is created, so it is usable immediately rather than requiring a separate format pass.

### Ported ciphers

- Added `src/main/crypto/serpent.cjs` and `src/main/crypto/twofish.cjs`, ported from the VeraCrypt source tree. Both reproduce that tree's own published ECB test vectors exactly, which is what makes containers written here readable elsewhere.
- Added `src/main/crypto/xts.cjs`, an XTS implementation for ciphers the platform does not provide. It is verified byte-identical to the platform's native AES-XTS across five data unit numbers.
- Camellia and Kuznyechik are not ported and are reported by name as unavailable. They are never silently substituted with AES.

### The benchmark measures this machine

- Added `src/main/benchmark.cjs` and the `tools:benchmark` IPC channel. Performance & Tools no longer shows a table of invented throughput figures: it starts empty, says so, and fills only after the button runs a real measurement. Each available cipher encrypts and decrypts a 1 MiB buffer through this build's own XTS path, 512 bytes at a time, and the buffer size and pass count are stated beside the results so a number can be interpreted.
- Camellia, Kuznyechik and unimplemented cascades no longer appear with a speed. They are listed as unavailable with the same reason the volume engine gives.

### Files inside a container, without a drive letter

- Added `src/main/fat32.cjs`: listing, reading, writing, extracting and deleting files, and creating folders, through a sector device that decrypts on read and re-encrypts on write. No drive letter, no kernel driver, and no external program is involved.

### Kernel driver built from source

- Added `scripts/build-driver.ps1`, which goes from a bare checkout to a verified `veracrypt.sys` and asserts the artifact it produced: x64, native subsystem, imports `ntoskrnl.exe`, and unsigned. Nothing signs, test-signs, or requests a certificate.
- Loading that driver requires the machine's owner to disable Windows driver signature enforcement themselves. This project does not do that and does not ask for it.

### Corrections to shipped behaviour

- The Volumes table previously displayed four invented containers on every machine. It now reads all twenty-six drive letters from the operating system, and marks a row mounted only when its NT device target belongs to the VeraCrypt driver.
- `scripts/prepare-renderer.mjs` transforms were written against LF and silently matched nothing on a CRLF checkout, so the build succeeded while shipping the prototype's data. The source is normalised on read, every required transform now fails the build when it changes nothing, and a final sweep refuses to emit prototype paths.
- The drive table now shows a loading line while the query runs and the real failure text when it fails, instead of an empty header.
- Drive results are cached in the main process, taking a repeat query from 549 ms to 0 ms and stopping the poll spawning a PowerShell process every five seconds.
- The application relaunches itself elevated once per start, because the driver ignores unelevated callers; declining the prompt keeps it running rather than exiting.
- Added `scripts/ensure-electron-binary.mjs`, because npm can leave the electron package installed with no executable while electron's own installer exits 0 after failing.
- Removed the VeraCrypt download, extraction and winget-install machinery. Nothing is installed on the user's behalf.

### Verification

- `npm test` is green with **81/81** passing tests, including the volume engine, the ported ciphers against upstream vectors, and the FAT32 layer.
- `npm run test:all` is green across brand, design coverage, security, workflow and packaging guards.
- The 36-state capture matrix was regenerated from the packaged build at the released commit.

## 0.1.9

### Verification

- `npm test` is green with **55/55** passing tests; `npm run test:all` is also green.
- The packaged capture manifest dated `2026-08-12` covers all 14 destinations in 36 states: 24 packaged UI interactions, one actual bridge/runtime observation (healthy local Ollama `v0.32.9`), and 11 explicitly labelled seeded visual fixtures.
- Seeded fixtures document deterministic renderer states only. They are not live conversion, model catalog/download, chat, harness, restore, or Ollama-service proof.

### Application structure

- Expanded the hand-written application inventory from 13 to 14 destinations by adding Ollama Studio.
- Kept the original Material Encryption vault-and-volume logo and added four local chrome treatments, bounded custom image upload, contain/cover fit, background selection, nine generated PNG sizes, persistence, and reset.

### File Converter

- Replaced the flat format presentation with searchable categories for Documents/PDF, Images, Audio, Video, Archives, Structured Data/Spreadsheets, Code/Text, and Binary Encodings.
- Made bundled adapters and known unavailable formats explicit, including the exact missing adapter or reason for each unavailable format.
- Added PDF inspect, split, merge, page extraction, reorder, rotate, and metadata editing with short-lived plans, atomic writes, and reopened-output validation.
- Replaced the former 32-file batch boundary with incremental file and folder queue intake, bounded worker concurrency, persisted pause/resume/cancel/retry state, storage preflight, restart recovery, and independent per-file outcomes. Persisted queue state has an explicit 100,000-job safety ceiling.

### Ollama Studio

- Added fixed-loopback Ollama runtime discovery and health guidance using an allowlist of documented local API operations.
- Added an exhaustive official model/tag catalog refresh that follows bounded same-origin pagination, records a content revision and timestamp, and falls back to a validated stale cache while offline.
- Added conservative PC-fit results backed by model size/context evidence, RAM, available RAM, GPU/VRAM inventory, and free disk, with an explicit Unknown state when evidence is incomplete.
- Added the free Download Cart with disk preflight, bounded parallel pulls, progress, cancellation, retry, and separate partial outcomes.
- Added local chat over bounded complete-response manager transport with cancellation, a system prompt, validated generation parameters, conversation state, stop/regenerate controls, and export guidance; the current IPC returns one validated response after completion.
- Added reviewed harness profiles with executable and argument previews, allowlisted configuration snapshots, automatic rollback after failed launch, and explicit snapshot restore. No arbitrary shell field is exposed.
- Added bundled in-app recovery guidance for missing bridges, stopped or unhealthy runtimes, empty model inventories, failed downloads, chat failures, and harness restore states.

### Verification status

- Expanded the Node test inventory to 55 tests across VeraCrypt, TOTP, logo, converter, PDF/queue, Ollama manager, and bridge contracts.
- Installer, release, and hosted documentation verification remain pending; no unverified release claim is made here.
