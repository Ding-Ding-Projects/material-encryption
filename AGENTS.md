# Shared engineering requirements — sanitized mirror

This file mirrors the public, repository-applicable parts of the owner's shared engineering requirements. Update the canonical private source first; this copy does not propagate changes.

- Preserve unrelated work. Inspect status and diffs before editing, use Git and GitHub CLI tools for repository operations, and never force-push without explicit authorization.
- Commit coherent work with the configured project author, a concise English subject, a playful Hong Kong Cantonese body, and the required co-author trailer.
- Keep Material Design 3, keyboard access, visible focus, screen-reader names, contrast, reduced motion, touch targets, narrow layouts, high display scales, and localized English/Cantonese/bilingual copy complete.
- Keep every search surface wired to a bounded full regex builder with plain text as the default.
- Keep tab navigation, grouping, pinning, discovery, appearance editing, exports, bulk actions, non-blocking notifications, history, documentation, and destructive confirmation functional rather than decorative.
- Keep secrets out of source, logs, command arguments, screenshots, exports, history, issues, discussions, and releases. Use operating-system credential storage where a credential is required.
- Do not sign code. Windows desktop packaging uses unsigned Squirrel.Windows artifacts and states the unknown-publisher warning honestly.
- CI builds, packages, and releases on each push and manual dispatch. It does not run tests or lint; local checks run before a push, and release notes report what actually ran.
- Every repository-changing task updates relevant documentation, changelog/handoff records, real captures, and the landing or documentation site where applicable.
- Build scripts restore dependencies automatically on a fresh Windows machine, support silent mode, build the real artifact, and fail with exact errors.
- Runtime UI verification must use an isolated headless desktop and must not steal focus from the user's visible desktop.
- Never bundle VeraCrypt, its binaries, or secret material. Treat the local VeraCrypt installation as the cryptographic engine and keep all process arguments allowlisted.
