# Changelog

## Unreleased

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
- Added local chat over bounded streaming manager transport with cancellation, a system prompt, validated generation parameters, conversation state, stop/regenerate controls, and export guidance; the current IPC returns the accumulated response after completion.
- Added reviewed harness profiles with executable and argument previews, allowlisted configuration snapshots, automatic rollback after failed launch, and explicit snapshot restore. No arbitrary shell field is exposed.
- Added bundled in-app recovery guidance for missing bridges, stopped or unhealthy runtimes, empty model inventories, failed downloads, chat failures, and harness restore states.

### Verification status

- Expanded the Node test inventory to 41 tests: 3 VeraCrypt, 3 TOTP, 10 converter, 5 converter bridge, 10 PDF/queue, and 10 Ollama tests.
- Existing runtime assets document the previous 24-state baseline only. A current all-destination capture matrix, final local suite, installer, release, and hosted documentation verification remain pending.

Commit links will be added only after the final integration commit exists; no placeholder SHA is published.
