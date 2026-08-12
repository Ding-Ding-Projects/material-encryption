# Documentation

This documentation describes the current unreleased source and separates implemented behavior from packaged-runtime and release evidence.

## Feature categories

- [Volumes](volumes/README.md)
- [Design and appearance](design/README.md)
  - [Application logo and icon customization](design/app-logo.md)
- [Tools](tools/README.md)
  - [Local File Converter](tools/file-converter.md)
- [Ollama](ollama/README.md)
  - [Ollama Studio](ollama/ollama-studio.md)
- [Security](security/README.md)
- [Build and release](release/README.md)
  - [Complete local suite inventory](release/local-suite-inventory.md)

## Current application map

The design and production coverage guard list 14 destinations: Volumes, Favorite Volumes, Volume Creation Wizard, Volume Properties, Security, Performance & Tools, File Converter, Ollama Studio, Preferences, History, Locked surfaces, Authenticator, Support Tickets, and Settings.

## Verification boundary

- **Implemented source:** the current tree contains the 14-destination renderer plus converter, PDF/queue, and Ollama main/preload bridges.
- **Local test inventory:** six Node test files currently declare 41 tests. This count describes the suite source; the final integrated suite still has to run at the candidate commit.
- **Existing packaged captures:** `docs/assets/runtime` contains 24 images from the previous 13-destination packaged baseline. It has no Ollama Studio image and does not prove the final current candidate.
- **Pending:** final complete local checks, refreshed all-destination packaged captures, unsigned installer verification, release publication, and hosted-site verification.

## Existing packaged-runtime examples

These image files exist and may be inspected as the previous packaged baseline:

![Packaged Material Encryption Volumes destination](assets/runtime/material-encryption-volumes.png)
![Packaged app logo customizer](assets/runtime/material-encryption-logo.png)
![Packaged local File Converter](assets/runtime/material-encryption-converter.png)
![Packaged light theme](assets/runtime/material-encryption-light.png)
![Packaged 390 by 844 narrow layout](assets/runtime/material-encryption-narrow.png)

The [capture manifest](assets/runtime/capture-manifest.json) records that historical 24-state matrix. A current Ollama Studio capture is intentionally not shown because no such file exists yet.
