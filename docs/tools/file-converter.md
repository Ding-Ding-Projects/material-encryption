# Local File Converter

The File Converter inspects local files before it plans or writes anything. Native pickers issue opaque capability tokens, so renderer code cannot submit an arbitrary path. Detection examines bounded content bytes first and reports extension disagreements instead of trusting a renamed file.

## Categorized adapter catalog

Each category is searchable in the application and keeps its own plain-text-first regex-builder route. Available entries state the bundled adapter; unavailable entries remain visible and name the exact missing adapter or reason.

| Category | Available in the current bundle | Visible but unavailable examples |
|---|---|---|
| Documents/PDF | PDF inspection and tools through `pdf-lib` | DOCX, ODT, RTF |
| Images | PNG identity; JPEG identity and JPEG-to-PNG through Electron `nativeImage` | GIF, WebP, SVG, TIFF |
| Audio | None | MP3, WAV, FLAC, Ogg |
| Video | None | MP4, WebM, Matroska, QuickTime; tools on `PATH` are never borrowed |
| Archives | None | ZIP, 7z, TAR, Gzip |
| Structured Data/Spreadsheets | JSON, JSON Lines, YAML, TOML, XML, CSV, TSV | XLSX, ODS |
| Code/Text | UTF-8 text, Markdown, HTML | Language-aware source transformation |
| Binary Encodings | Arbitrary binary, Base64, hexadecimal | — |

Supported transformations include UTF-8 text and Markdown, structured JSON/JSONL/YAML/TOML/XML/CSV/TSV conversions, HTML and Markdown representations, Base64 and hexadecimal round trips, binary-to-Base64/hex, PNG passthrough, and lossless JPEG-to-PNG decoding. Lossy PNG-to-JPEG remains refused. Unknown bytes retain only universal lossless Base64 and hexadecimal routes.

## PDF tools

The Documents/PDF category includes:

- inspect page count, geometry, rotation, and metadata;
- split every page or explicit ranges;
- merge inputs in selected order;
- extract selected pages;
- reorder pages;
- rotate by validated quarter-turns;
- edit the allowlisted title, author, subject, keywords, creator, and producer fields.

PDF documents are limited to 512 pages, each input uses the ordinary 8 MiB bound, and a plan may combine at most 64 MiB of selected PDF input. Mutating operations require an opaque destination capability. Plans expire after five minutes, are capped at 32 live records, and are consumed once. Output is written atomically and reopened to validate expected page count, page order, rotation, and metadata before success is reported.

## Persistent conversion queue

The queue is designed for a practically unbounded user flow without loading all selected paths or bytes into memory at once:

- file and recursive folder intake is processed incrementally in chunks of 128 records;
- the old 32-file selection ceiling is removed;
- persisted state has an explicit 100,000-job safety ceiling;
- worker concurrency is bounded from 1 to 8 and is set to 2 by the application;
- only the active workers read file bytes; pending records remain lightweight persisted metadata;
- each input is capped at 8 MiB and each output at 16 MiB;
- storage preflight estimates required bytes per destination and blocks known insufficient capacity;
- pause, resume, cancel, retry, crash/restart recovery, group rules, and per-file outcomes are persisted;
- an interrupted `running` record returns to `queued` on restart;
- converted, failed, cancelled, and partial outcomes remain separate.

The queue state file is validated against a versioned allowlist before work resumes. Unknown fields, unsafe paths or names, invalid formats, malformed status records, oversized state, and out-of-bound numeric values fail closed.

## Privacy and security

- Source and destination paths are selected in the main process. Renderer responses use display-safe names, opaque tokens, and path-free errors.
- Content detection is bounded. Symbolic-link and reparse-point intake is rejected or skipped, destination traversal is rejected, and implicit overwrite is refused.
- A selected input is fingerprinted; changed bytes invalidate the original capability before conversion.
- Writes use temporary files and atomic rename. PDF writes retain or restore the prior destination if replacement fails.
- No converter adapter uses a network service, arbitrary executable, shell command, unbundled tool from `PATH`, or VeraCrypt credential.
- A failed item never disguises successful or failed siblings. Unsupported and lossy routes remain unavailable rather than producing guessed, mislabeled, truncated, or corrupt output.

## Failure modes and recovery

The application reports stable error codes and actions for malformed or unsupported input, invalid UTF-8, oversize input/output, expired PDF plans, changed input, unsafe destinations, existing outputs, insufficient storage, corrupt saved queue state, unavailable queue storage, and conversion or write failure. The source remains unchanged, successful siblings remain recorded, and failed/cancelled jobs can be explicitly retried after the named condition is corrected.

## Verification

Current source coverage includes:

- `tests/file-converter.test.mjs`: 10 tests;
- `tests/converter-bridge-contract.test.mjs`: 5 tests;
- `tests/pdf-tools.test.mjs`: 10 tests.

That is 25 converter/PDF/queue tests within the 41-test Node inventory. The existing [File Converter capture](../assets/runtime/material-encryption-converter.png) belongs to the previous packaged baseline; the final current package must be recaptured after integration.

## Suggested articles

- [Tools index](README.md)
- [Security architecture](../security/README.md)
- [Ollama Studio](../ollama/ollama-studio.md)
- [Complete local suite inventory](../release/local-suite-inventory.md)
