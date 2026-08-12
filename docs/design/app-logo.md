# App logo and icon customization

Material Encryption ships one original vault-and-volume mark. `design/material-encryption-logo-master.png` is the committed high-resolution source; `scripts/generate-brand-assets.py` deterministically produces design and renderer PNGs plus a real Windows ICO containing 16, 20, 24, 32, 40, 48, 64, 128, and 256 pixel frames.

The Settings **App logo** tab offers four shipped visual treatments, a bounded local PNG/JPEG/WebP upload, contain/cover fit, a background color, live preview, a generated nine-size PNG set, and reset. A chosen image stays in local browser storage and changes only the app chrome. It does not rename or rewrite the executable, installer, package identity, update feed, or application-data directory.

## Failure modes and security

- Files over 5 MiB, images over 4096 × 4096, malformed images, and unsupported types are rejected without replacing the last valid logo.
- Processing is local; the Content Security Policy denies network connections.
- The executable always carries the reviewed shipped icon. Packaging applies that icon without signing, then extracts and verifies it from the built executable.

## Verification

Run `npm run test:brand`, `npm run package`, and `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-packaged-icon.ps1 -Executable 'dist\win-unpacked\Material Encryption.exe'`. The packaged [logo-customizer capture](../assets/runtime/material-encryption-logo.png) proves the live surface.

## Suggested articles

- [Design implementation](README.md)
- [Local file converter](../tools/file-converter.md)
- [Build and release](../release/README.md)
