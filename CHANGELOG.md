# Changelog

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
