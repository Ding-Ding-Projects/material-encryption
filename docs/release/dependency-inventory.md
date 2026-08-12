# Workflow dependency inventory

| Job | Runner | Required dependencies | Bootstrap path | First real work |
|---|---|---|---|---|
| `release` | `windows-2025` x64 | Git checkout, Node.js 22, npm, dependencies locked by `package-lock.json`, Electron, electron-builder, electron-builder-squirrel-windows, PowerShell, GitHub CLI, HTTPS access to the published dim-sum catalog asset | `actions/checkout`, `actions/setup-node`, then `npm ci` from the canonical npm registry | `npm run prepare:renderer` |

The workflow installs all project dependencies on each cache-miss path. Code-signing tools and credentials are deliberately absent. It invokes `npm run dist:unsigned`, which packages only and does not transitively run tests or lint. A future workflow job must be added to this hand-written table and to `scripts/verify-workflow-inventory.mjs` in the same change.
