# Material Encryption

Material Encryption is a Material Design 3 Windows desktop interface for a separately installed copy of [VeraCrypt](https://www.veracrypt.fr/). VeraCrypt remains the cryptographic authority; this project provides discoverable volume workflows plus local conversion, Ollama management, appearance, history, lock, authenticator, support, and settings surfaces.

![Material Encryption logo: a violet and cyan vault aperture above an encrypted-volume tray](design/assets/material-encryption-logo.png)

[Documentation](docs/README.md) · [Documentation site](https://ding-ding-projects.github.io/material-encryption/) · [Latest published release](https://github.com/Ding-Ding-Projects/material-encryption/releases/latest)

> [!IMPORTANT]
> Material Encryption is independent from VeraCrypt. It never bundles VeraCrypt, never implements encryption, and never puts a volume password on a process command line. VeraCrypt must be installed separately.

> [!NOTE]
> The 14-destination application, expanded converter, and Ollama Studio described below are currently unreleased. The source test inventory contains 41 Node tests, but the final complete local suite, packaged runtime captures, installer, release, and hosted-site verification must be refreshed at the final candidate commit.

## Install and build

- Run `build.bat` for a fresh-machine dependency restore, build, and optional launch prompt.
- Run `build.bat /s` or `build.bat --silent` for a noninteractive build.
- Run `build-installer.bat /s` for the unsigned Squirrel.Windows setup and update package set.

The Windows installer is intentionally unsigned and may trigger an unknown-publisher or SmartScreen warning.

<details>
<summary>Fourteen application destinations</summary>

The left navigation exposes these hand-listed destinations:

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

The renderer is generated from `design/VeraCrypt Material.dc.html`. `scripts/prepare-renderer.mjs` removes preview-only credentials and sample state, replaces network resources with local assets, and adds the constrained desktop bridge. `scripts/verify-design-coverage.mjs` checks the compiled design and all 14 destination names.

</details>

<details>
<summary>Original and customizable application logo</summary>

The project ships its own vault-and-volume mark. The Settings **App logo** tab provides four shipped treatments, a local PNG/JPEG/WebP picker, contain/cover fit, background color, a live preview, nine downloadable PNG sizes, persistence, and reset. A custom image changes only local application chrome; it cannot change the executable, installer, package identity, update feed, or application-data directory.

See [App logo and icon customization](docs/design/app-logo.md).

</details>

<details>
<summary>Categorized local File Converter and PDF tools</summary>

The converter presents Documents/PDF, Images, Audio, Video, Archives, Structured Data/Spreadsheets, Code/Text, and Binary Encodings as separate searchable categories. Available adapters are identified as bundled; unavailable formats remain visible with the exact missing adapter instead of borrowing an executable from `PATH` or pretending a conversion succeeded.

PDF tools inspect, split, merge, extract pages, reorder, rotate, and edit metadata. Mutating plans are short-lived and single-use, outputs are written atomically, and generated PDFs are reopened to verify page count, order, rotation, and metadata before success is reported.

The persistent queue no longer has the old 32-file batch limit. It incrementally accepts file or folder work, persists resumable state, processes file bytes only within a bounded worker pool, preflights storage, and records converted, failed, and cancelled outcomes independently. Its explicit safety ceiling is 100,000 job records, with concurrency configurable from 1 to 8 and set to 2 by the application.

See [Local File Converter](docs/tools/file-converter.md).

</details>

<details>
<summary>Ollama Studio</summary>

Ollama Studio uses the fixed local Ollama endpoint and an allowlist of documented API routes for health, installed models, model details, pulls, deletion, and chat. Its Model Store follows the official registry's bounded same-origin pagination for every official model and published tag, records a content revision and refresh time, and falls back to the last validated catalog when offline.

Every variant receives a conservative **Runs well**, **Runs with limits**, **Unlikely**, or **Unknown** result. The result shows the available evidence—model bytes and context where reported, RAM, available RAM, GPU/VRAM inventory, and free disk—and remains **Unknown** rather than guessing when decisive metadata is unavailable.

The Download Cart is a free bounded-parallel batch pull surface, not a storefront. It preflights disk, reports per-model progress and partial outcomes, and supports cancellation and retry. Chat uses Ollama's streaming response format with cancellation, a system prompt, validated generation parameters, conversation state, and export guidance. The current IPC returns the accumulated response when the operation completes; attachments remain disabled unless both the selected model and the application bridge support them.

Harness launch is limited to discovered or explicitly reviewed profiles. The application previews the executable, arguments, and configuration changes, snapshots allowlisted configuration files, restores automatically after a failed launch, and offers explicit snapshot restore. It never exposes an arbitrary shell box.

See [Ollama Studio](docs/ollama/ollama-studio.md).

</details>

<details>
<summary>Privacy, security, and guided recovery</summary>

- The renderer is sandboxed and context-isolated, with no Node.js access and no general network permission.
- Preload exposes narrow operations; the main process validates records, strings, file selections, destinations, model names, local endpoints, routes, and process profiles.
- File paths reach the renderer only as display-safe names and opaque capability tokens. Converter and Ollama errors are reduced to stable public codes and path-free recovery messages.
- Ollama runtime traffic is restricted to `http://127.0.0.1:11434`; official catalog refreshes use bounded HTTPS requests to `registry.ollama.ai` and reject redirects or cross-origin pagination.
- The Ollama surface includes bundled offline help and contextual missing-bridge, stopped-runtime, empty-model, failed-download, chat, launch, and restore guidance. Disabled controls state the missing condition and the next in-app action.
- VeraCrypt owns password entry. Passwords never enter this application's IPC, settings, logs, exports, or process arguments.
- Destructive actions retain the two-key and confirmation-slider flow before an allowlisted operation can run.

See [Security architecture](docs/security/README.md).

</details>

<details>
<summary>Documentation index</summary>

- [Documentation home](docs/README.md)
- [Volume operations](docs/volumes/README.md)
- [Design implementation](docs/design/README.md)
- [Application logo](docs/design/app-logo.md)
- [Tools](docs/tools/README.md)
- [Local File Converter](docs/tools/file-converter.md)
- [Ollama](docs/ollama/README.md)
- [Ollama Studio](docs/ollama/ollama-studio.md)
- [Security architecture](docs/security/README.md)
- [Build and release](docs/release/README.md)
- [Complete local suite inventory](docs/release/local-suite-inventory.md)

</details>

<details>
<summary>Existing packaged-runtime captures</summary>

These files exist under `docs/assets/runtime` and document the previous 24-state packaged baseline. They do not yet prove the newly added Ollama Studio destination or the final current candidate.

### Primary surfaces

![Material Encryption Volumes screen with truthful empty drive rows, project logo, left navigation, and docked tabs](docs/assets/runtime/material-encryption-volumes.png)

![Material Encryption app logo customizer with shipped treatments, local upload, image fit, background, generated sizes, and reset](docs/assets/runtime/material-encryption-logo.png)

![Material Encryption local File Converter with source queue, adapter capabilities, target and output controls, preview, and loss disclosure](docs/assets/runtime/material-encryption-converter.png)

<details>
<summary>Existing destination captures</summary>

![Favorite Volumes truthful empty state](docs/assets/runtime/material-encryption-favorites.png)
![Volume Creation Wizard](docs/assets/runtime/material-encryption-create.png)
![Volume Properties truthful authoritative-state notice](docs/assets/runtime/material-encryption-properties.png)
![Security tools](docs/assets/runtime/material-encryption-security.png)
![Performance and Tools](docs/assets/runtime/material-encryption-tools.png)
![Preferences](docs/assets/runtime/material-encryption-preferences.png)
![History truthful empty state](docs/assets/runtime/material-encryption-history.png)
![Locked surfaces](docs/assets/runtime/material-encryption-locks.png)
![Authenticator](docs/assets/runtime/material-encryption-auth.png)
![Support Tickets](docs/assets/runtime/material-encryption-support.png)
![Settings](docs/assets/runtime/material-encryption-settings.png)

</details>

<details>
<summary>Existing dialogs, safety, search, themes, and responsive-layout captures</summary>

![Command palette](docs/assets/runtime/material-encryption-palette.png)
![Full regex builder](docs/assets/runtime/material-encryption-regex.png)
![Per-element appearance editor](docs/assets/runtime/material-encryption-appearance.png)
![Two-key destructive super confirmation](docs/assets/runtime/material-encryption-confirm.png)
![Searchable exact-element context menu](docs/assets/runtime/material-encryption-menu.png)
![Independent four-step lock wizard anchored to the exact Volumes heading](docs/assets/runtime/material-encryption-lock-wizard.png)
![Searchable keyboard navigator for selecting any exact rendered element](docs/assets/runtime/material-encryption-navigator.png)
![Non-blocking operation error notification](docs/assets/runtime/material-encryption-error.png)
![Settings in the verified light Material theme](docs/assets/runtime/material-encryption-light.png)
![File Converter at a 390 by 844 narrow viewport](docs/assets/runtime/material-encryption-narrow.png)

</details>

The existing [capture manifest](docs/assets/runtime/capture-manifest.json) records 24 states. A new Ollama Studio capture and a refreshed complete matrix remain required before the current candidate can claim packaged-runtime proof.

</details>

## Project records

[Roadmap](ROADMAP.md) · [Handoff](HANDOFF.md) · [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [License](LICENSE)

## Shared-instruction mirror

This public repository follows a sanitized mirror of the project's shared engineering requirements in [AGENTS.md](AGENTS.md). Machine-specific locations, private infrastructure, private vocabulary, and credentials are deliberately excluded.
