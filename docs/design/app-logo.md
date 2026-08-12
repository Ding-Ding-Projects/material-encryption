# App logo and icon customization

Material Encryption ships one original vault-and-volume mark. `design/material-encryption-logo-master.png` is the committed high-resolution source; `scripts/generate-brand-assets.py` deterministically produces design and renderer PNGs plus a real Windows ICO containing 16, 20, 24, 32, 40, 48, 64, 128, and 256 pixel frames.

The Settings **App logo** tab offers four shipped visual treatments, a bounded local still PNG/JPEG/WebP upload, contain/cover fit, background color, crop zoom, horizontal and vertical focal controls, live previews at every consumed 16–256 pixel size, a generated nine-size PNG set, and reset. A chosen image becomes a normalized PNG generation in bounded application data and changes only app chrome. It does not rename or rewrite the executable, installer, package identity, update feed, or application-data directory.

## Failure modes and security

- The renderer can request the native file dialog but cannot submit a path, source bytes, or source data URL. The main process returns an opaque, short-lived, single-use selection capability plus normalized preview output.
- Signatures are checked from bytes rather than file extensions. Files over exactly 5,242,880 bytes, dimensions over 4096 pixels per side, decoded images over exactly 16,777,216 pixels, malformed images, animated PNG/WebP, multi-picture JPEG, and unsupported types are rejected without replacing the last valid logo.
- Decoding uses bundled Sharp with bounded input pixels and strict failure handling. Accepted images are rasterized to still PNG; animation, extra frames, original metadata, and original encoding are intentionally discarded.
- All nine PNGs are generated and validated in a staging generation. A small active-generation record switches only after the complete set succeeds, so an interrupted attempt retains the previous valid set.
- Processing is local; the Content Security Policy denies network connections.
- The executable always carries the reviewed shipped icon. Packaging applies that icon without signing, then extracts and verifies it from the built executable.

## Verification

Run `node --test tests/logo-service.test.mjs`, `npm run test:brand`, `npm run test:design`, `npm run test:security`, and `npm run package`, then run `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/verify-packaged-icon.ps1 -Executable 'dist\win-unpacked\Material Encryption.exe'`. The packaged [logo-customizer capture](../assets/runtime/material-encryption-logo.png) proves the live surface.

## Suggested articles

- [Design implementation](README.md)
- [Local file converter](../tools/file-converter.md)
- [Build and release](../release/README.md)
