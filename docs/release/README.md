# Build and release

`build.bat` restores locked dependencies, regenerates the renderer, runs local checks, and builds the unpacked application. Silent modes are `/s`, `--silent`, and `SILENT=1`. `build-installer.bat` calls that route and creates unsigned Squirrel.Windows setup and update artifacts.

The installer path must verify `Setup.exe`, `RELEASES`, the full package, unsigned status, intended source commit, and SHA-256. It never publishes, tags, pushes, or creates a release.

The logo source produces a nine-size Windows ICO. Packaging keeps signer discovery disabled, applies only the reviewed icon resource through the deterministic local resource path, extracts the icon from the built executable, and proves the executable remains unsigned.

Release automation builds and publishes on every push and manual dispatch. Tests and lint remain local and do not run in the workflow. This reduces publication latency but means automation can publish a commit whose local checks were skipped; release notes must name only the checks actually run and their real results.

## Current candidate status

The current source adds:

- a 14th destination, Ollama Studio;
- an eight-category converter registry;
- PDF inspect/split/merge/extract/reorder/rotate/metadata operations;
- a persistent resumable conversion queue with bounded worker concurrency;
- official Ollama model/tag catalog pagination and offline cache;
- evidence-based PC-fit results, free batch downloads, chat, and reviewed harness launch/restore;
- a total inventory of 41 Node tests.

These statements describe the source tree. They do not assert a final passing suite, current packaged capture matrix, current installer, new release, or current hosted-site deployment. The historical 24-state capture manifest lacks Ollama Studio and must be replaced or supplemented during the final release pass.

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
