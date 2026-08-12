# Design implementation

The product renderer is generated directly from `design/VeraCrypt Material.dc.html`, not recreated from screenshots. The current design and production renderer contain 14 hand-listed destinations:

1. Volumes
2. Favorite Volumes
3. Volume Creation Wizard
4. Volume Properties
5. Security
6. Performance & Tools
7. File Converter
8. Ollama Studio
9. Preferences
10. History
11. Locked surfaces
12. Authenticator
13. Support Tickets
14. Settings

The same renderer contains browser-style tabs, the command palette, full regex builder, preferences, appearance editing, destructive confirmation, notifications, export controls, history surfaces, locks, authenticator, support desk, converter, Ollama Studio, and language/tone settings.

`scripts/prepare-renderer.mjs` materializes the production renderer, removes preview-only secrets and fake state, removes network fonts, bundles the local React runtime, and attaches the constrained desktop bridge. `scripts/verify-design-coverage.mjs` compiles the design logic and checks every destination in both source and production output.

## Application identity

Material Encryption ships an original vault-and-volume logo. The Settings **App logo** surface offers four shipped treatments and a bounded local custom image path without changing installed identity. See [Application logo and icon customization](app-logo.md).

## Failure modes

- Generation fails when the design export, local React runtime, required destinations, or compilable design logic are absent.
- The renderer Content Security Policy blocks arbitrary network connections; privileged operations cross only the preload contract.
- A missing converter or Ollama bridge remains visible as a disabled state with in-app recovery guidance instead of sample data or a guessed success.
- Unsupported converter adapters remain visible and unavailable with their exact reason.
- Ollama catalog, hardware, download, chat, and harness results are presented as returned or unknown; the UI does not substitute a curated catalog or arbitrary command field.

## Current evidence

The current test inventory has 41 Node tests. The checked-in capture matrix predates Ollama Studio and covers the previous 13-destination package, so a refreshed 14-destination matrix remains required before the current design can claim packaged-runtime capture coverage.

## Suggested articles

- [Application logo and icon customization](app-logo.md)
- [Local File Converter](../tools/file-converter.md)
- [Ollama Studio](../ollama/ollama-studio.md)
- [Complete local suite inventory](../release/local-suite-inventory.md)
