# Changelog

## 0.1.10

### The Create button, pressed

- The Confirm password field had no value and no change handler: typing in it did nothing, and a mismatched confirmation still created the container. A confirmation box that cannot disagree is worse than none, because its presence claims a check happened. It now compares against the password, says so either way, and creation is refused when the two differ.
- The Use PIM checkbox was unbound and there was no way to enter a PIM or a volume label at all, even though the engine accepts both. Both are now real inputs, validated and passed through to the engine.
- Added `scripts/verify-wizard-runtime.mjs` (`npm run verify:wizard`). It drives the wizard in the packaged application with real mouse and keyboard events through the debugging protocol — not synthetic DOM events, which this renderer ignores — types a destination, size, password, confirmation, PIM and label, presses Create, and then reads the result back with the engine to prove the typed PIM and label reached the container and that a different PIM is refused. 22 checks.

### Release-grade verification pass

- Added `tests/benchmark.test.mjs` and inventory rows for the cipher benchmark. The benchmark shipped as a new main-process capability with no test and no completeness-inventory row; the hand-written inventory is only as good as the rows in it, which is exactly the gap it exists to expose.
- Corrected the Encryption Options copy. It stated that AES is "the fastest on this processor" — a measurement the program never took, and false on the machine it was corrected on: the benchmark this build ships reports Twofish at 28.3 MB/s against AES at 24.8 MB/s. It now names the default and points at the benchmark instead of asserting a result.
- Verified the four preceding user-interface changes against the packaged application rather than the source: the benchmark channel measures in the built artifact, unavailable ciphers carry null rates, the wizard's capability source resolves, and none of the previously fabricated values appear anywhere in the live DOM.
- The 36-state capture matrix was regenerated from the packaged build at this commit.

### Volume Properties reads the real container

- The Properties destination now takes a container path (typed or chosen through the native picker) and its password, then displays what the engine's own header read returns: location, container file size, volume and data area sizes, cipher, key derivation function, PIM, iteration count, sector size, header version, whether the volume is hidden, and whether the backup header was used.
- Filesystem label, total, used and free space inside the container are shown when the FAT32 filesystem can be read, and the exact reason is shown when it cannot.
- Nothing is invented: choosing, reading, a wrong password and an unreadable container each state their real condition, and the password is cleared from renderer state as soon as the reads that need it have finished.

### Right-click menus close again

- A right-click opened the element menu and nothing dismissed it. `src/renderer/bridge.js` had no outside-click handler at all: its capture-phase `click` listener returned early for anything that was not a locked element, so a click beside the menu left it on screen, and the `Edit this element appearance…` entry dispatched its event without closing. Escape was the only exit. Menus now close on outside press, on losing window focus, on resize, on scrolling the page behind them, on focus moving away, and on activating an entry — and closing returns focus to the control the menu was opened from. Outside dismissal is deliberately limited to menus: the lock wizard holds typed input across four steps and keeps its explicit Cancel and Escape routes.
- The application's own context menu had the same gap from the other direction: Escape cleared the dialog state and left `menu` set, so the menu stayed up, and nothing restored focus. Four new renderer transforms in `scripts/prepare-renderer.mjs` — `context menu close path`, `context menu escape close`, `context menu scrim close` and `context menu item activation close` — route every dismissal through one `closeAppMenu` method that also clears the menu's search query and hands focus back.

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

### Volume Creation Wizard

- The wizard now creates containers. Its final step calls the volume engine this application already ships, passing the path, size, password, cipher, key derivation function and filesystem chosen on the earlier steps, and reports the engine's real outcome — the created path, size, cipher, KDF and filesystem, or the exact error text.
- Step 7 previously showed a constant 63%, a constant "Speed 148 MB/s · Left 00:02:14" and a constant "8F2A C41D 9BE0 3E77" entropy pool, none of which measured anything. The percentage now comes from the engine's own progress events, and the rate and remaining time are computed from bytes actually written over elapsed time. Before either can be measured the step says so ("Speed not measurable yet", "no progress reported yet") instead of showing a number.
- The Random Pool now shows eight bytes drawn from the platform cryptographic random source, redrawn every second and mixed with each pointer movement over the window. The copy beside it states plainly that moving the mouse changes the displayed pool, and that the container's master key is drawn separately by the operating system rather than from it — the prototype's claim that mouse movement improved key strength was not true of this engine.
- The Filesystem dropdown offered NTFS, exFAT, FAT and ReFS, and NTFS was the default, while the engine writes FAT32 or leaves the container unformatted. It now offers exactly FAT32 and None, and FAT32 is the default.
- Encryption Options are populated from the engine's capability report. Camellia and Kuznyechik remain listed, disabled, with the engine's own reason shown beside them, rather than being offered as though they worked. The hash dropdown lists the key derivation functions the engine accepts, and those the runtime cannot provide are disabled with their reason.
- The Volume Size step named "drive F:" and "812.44 GB", both invented, on machines that may have no F: drive. It now reports the free space of the destination actually chosen, matched against the real drive rows, says plainly when no destination has been chosen or the drive cannot be matched, and warns when the requested size exceeds the free space available.
- The wizard's Select File… button now opens the native save dialog and fills in the container path, and a requested size below the engine's 64 MB minimum is refused with a message naming both figures.

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
