# Independent element toy locks

## Behavior

Every rendered element receives a stable, local target identifier. Its context menu exposes **Lock this element…**, and `Ctrl+Alt+L` opens a searchable keyboard navigator that reaches the same exact targets. Each target opens its own four-step anchored wizard and receives an independent password or TOTP credential.

Locks are opt-in and start locked on launch. A successful unlock applies only to that lock for the chosen duration: one activation, 15 minutes, 60 minutes, or the current application session. **Lock this element again** ends a timed or session unlock immediately.

## Security boundary and recovery

These are deliberately toy locks: a user-experience speed bump, not encryption, access control, or protection from another person who can use the computer. Each creation and unlock surface states this plainly. Deleting the application-data folder resets all toy locks.

Passwords are processed with a per-lock random salt and `scrypt`. TOTP uses RFC 6238 with SHA-1, six digits, a 30-second period, and a one-step clock-skew window. Pairing secrets and password verifiers are encrypted with Electron `safeStorage`; plaintext credentials are never written to settings, logs, exports, command arguments, or Git history.

## Failure modes

- If operating-system-backed encryption is unavailable, creation fails without changing lock state.
- Corrupt or unsupported lock-store data fails closed and is not partially applied.
- A wrong credential leaves the element locked and never deletes content.
- If an element is no longer rendered, its lock remains listed until explicitly removed or the application-data folder is reset.

## Verification

`npm run test:all` verifies the bridge contract, secret-safe process invocation, and RFC 6238 vectors for SHA-1, SHA-256, and SHA-512. Packaged runtime verification exercises the exact-element context menu, wizard anchoring, keyboard navigator, unlock, relock, and activation interception on a hidden desktop.
