# Volume operations

Material Encryption locates the installed `VeraCrypt.exe` in the standard Program Files directories. A mount request validates the selected existing container, device path, volume name, or 64-byte volume ID and a single drive letter. It then opens VeraCrypt without a password argument so VeraCrypt owns the credential prompt.

Unmount, unmount-all, password-cache wipe, device auto-mount, preferences, and native tools use fixed allowlisted switches. Errors are returned as non-blocking notifications. A missing installation produces a recovery message and never falls back to another cryptographic tool.

## Security considerations

Material Encryption does not parse, retain, log, or export the volume password. A mounted volume is ordinary readable storage to applications and accounts that can access its drive letter; this interface does not change VeraCrypt's security model.

## Verification

The adapter tests reject shell-like drive input, allow valid volume IDs and device paths, and reject newline-containing paths. Packaged-runtime verification must confirm the native prompt is opened without focus stealing in the visible user session.
