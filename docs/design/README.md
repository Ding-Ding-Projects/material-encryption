# Design implementation

The product renderer is generated directly from `design/VeraCrypt Material.dc.html`, not redrawn from screenshots. The build keeps its 12 destinations, browser-style tabs, command palette, full regex builder, preferences, appearance editor, confirmation flow, notifications, export surface, local history concept, locks, authenticator, support desk, and language/tone settings.

Preview-only secrets, sample credentials, fake mounted volumes, and network font references are removed before production. React and the design runtime are bundled locally. `scripts/verify-design-coverage.mjs` is the hand-written completeness guard.

## Failure modes

Generation fails when the design export, local React runtime, or required destinations are absent. The renderer CSP blocks network connection attempts. Unsupported or unfinished product capabilities remain labelled rather than being represented as successful operations.
