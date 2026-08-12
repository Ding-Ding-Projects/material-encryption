# Build and release

`build.bat` restores locked dependencies, regenerates the renderer, runs local checks, and builds the unpacked application. Silent modes are `/s`, `--silent`, and `SILENT=1`. `build-installer.bat` calls that route and creates unsigned Squirrel.Windows setup and update artifacts.

The installer path resolves package version `0.1.9`, which is monotonic beyond the published `0.1.8` baseline. It verifies the exact `MaterialEncryption-Setup-0.1.9-x64.exe`, `RELEASES`, and `material-encryption-0.1.9-full.nupkg` names, requires the index to link that exact full package, checks unsigned status, and reports SHA-256. It never publishes, tags, pushes, or creates a release.

The logo source produces a nine-size Windows ICO. Packaging keeps signer discovery disabled, applies only the reviewed icon resource through the deterministic local resource path, extracts the icon from the built executable, and proves the executable remains unsigned.

Release automation builds and publishes on every push and manual dispatch. The packaging-only `dist:unsigned` script prevents the workflow from inheriting local tests through an npm script. Tests and lint remain local and do not run in the workflow. This reduces publication latency but means automation can publish a commit whose local checks were skipped; release notes must name only the checks actually run and their real results.

Each release tag uses `v0.1.9-build.<run number>`: the package version remains monotonic for Squirrel.Windows while the run suffix keeps every workflow release unique. Publication requires exactly five named assets: setup, `RELEASES`, the full package, `build-evidence.json`, and the selected decoded public-catalog dim-sum PNG. Both staging and the published release are compared against that exact set; a count-only match, a recursive first match, or an index pointing at another package fails publication.

## Current candidate status

The current source adds:

- a 14th destination, Ollama Studio;
- an eight-category converter registry;
- PDF inspect/split/merge/extract/reorder/rotate/metadata operations;
- a persistent resumable conversion queue with bounded worker concurrency;
- official Ollama model/tag catalog pagination and offline cache;
- evidence-based PC-fit results, free batch downloads, chat, and reviewed harness launch/restore;
- package version `0.1.9`;
- 55/55 passing `npm test` tests and a green `npm run test:all`;
- a dated 36-state packaged capture manifest covering all 14 destinations: 24 packaged UI interactions, one actual healthy local Ollama `v0.32.9` bridge/runtime observation, and 11 seeded visual fixtures. Fixtures are renderer-only and do not prove live conversion, model, download, chat, harness, restore, or Ollama-service behaviour.

These statements describe the current local evidence. They do not assert a current installer, new release, remote CI result, or hosted-site deployment.

## Release sequence

1. Run every command in the [complete local suite inventory](local-suite-inventory.md) at the integrated candidate commit.
2. Package the real application and verify the executable remains unsigned.
3. Capture and inspect all 14 destinations, including Ollama Studio, plus required dialog, failure, theme, and narrow states through the isolated hidden-desktop route.
4. Run `build-installer.bat /s` and verify the Squirrel.Windows files, source commit, hashes, and unsigned status.
5. Publish exactly one unique release for the final commit and verify its assets, notes, timing, and line evidence.
6. Publish and verify the documentation site from the same released state.

## Suggested articles

- [Complete local suite inventory](local-suite-inventory.md)
- [Local File Converter](../tools/file-converter.md)
- [Ollama Studio](../ollama/ollama-studio.md)
- [Application logo](../design/app-logo.md)
