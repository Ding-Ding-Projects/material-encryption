# Ollama Studio

Ollama Studio is a separate destination for discovering and operating a local Ollama runtime. It provides five guided sections: runtime and recovery, Model Store, Download Cart, chat, and harness profiles/restore.

## Local runtime boundary

The manager accepts only the exact loopback origin `http://127.0.0.1:11434` (with the compatible `/v1` spelling normalized to the same origin). The main process allowlists these documented local routes:

- `/api/version`
- `/api/tags`
- `/api/show`
- `/api/pull`
- `/api/delete`
- `/api/chat`

Requests reject redirects, omit credentials, use bounded response sizes and timeouts, and parse JSON or newline-delimited JSON with UTF-8, line, event, and total-stream limits. Model names and every request record are validated before a call.

The runtime screen reports bridge presence, health, version, installed models, and contextual recovery. Bundled offline help explains the exact in-app next action when the bridge is missing, the local service is stopped or unhealthy, or no model is installed. Disabled controls carry the missing condition; the surface never substitutes a sample success.

## Exhaustive official Model Store

On refresh, the manager:

1. requests every page of the official registry catalog;
2. retains official `library/` repositories;
3. requests every page of tags for every retained model;
4. preserves every returned tag as a separately selectable variant;
5. combines official variants with the installed inventory;
6. records a deterministic content revision, fetch timestamp, source, and stale state;
7. atomically caches the validated catalog for offline fallback.

Pagination is bounded to 256 pages per traversal, 10,000 repositories, and 250,000 tags. Cycles, redirects, credentials in URLs, cross-origin links, unsafe paths, malformed records, and oversized responses are rejected. When refresh fails and a validated cache exists, the UI identifies it as cached and stale; without a cache it reports the failure rather than showing a curated subset.

The Model Store supports search plus filters for fit, capabilities, family, quantization, and size. The search has an adjacent regex route and can open the full application regex builder. Variant detail comes from the local runtime's model inventory/detail API when available; unavailable facts remain unknown.

## PC-fit evidence

Every variant receives exactly one conservative verdict:

- **Runs well** — currently available memory and disk exceed conservative requirements with headroom.
- **Runs with limits** — the evidence meets conservative minimums with limited headroom.
- **Unlikely** — reported memory or disk is below a conservative requirement.
- **Unknown** — decisive model or hardware data is unavailable.

The evaluator uses exact model bytes when reported, context length when reported, a conservative context overhead, total and available RAM, GPU/VRAM inventory, and free disk. Required memory includes model and context overhead; required disk includes model bytes plus download headroom. The evidence and caveats stay attached to the verdict. The manager never derives a promise from a model name, parameter label, family, or quantization alone.

## Download Cart

The Download Cart means a batch of free local model pulls; it is not commerce.

- The UI states `$0 — no purchase` and never collects payment.
- The cart accepts up to 128 validated model variants per batch.
- Pull concurrency is bounded from 1 to 3 and the application requests 2.
- Known model sizes are preflighted against free disk with conservative overhead before network writes begin.
- Streaming progress is bounded and cancellable.
- Completed, failed, cancelled, skipped, and partial outcomes remain separate.
- Failed or cancelled variants can be placed back into the cart for an explicit retry; completed models remain installed.

Unknown model size remains visible as unknown instead of being guessed. A known insufficient disk result skips the affected pull before it contacts the local runtime.

## Local chat

Chat uses `/api/chat` with a selected installed model. The manager consumes Ollama's streamed response format and supports cancellation, while the current main/preload call returns the accumulated response to the renderer when the operation completes. The surface also supports:

- bounded streamed-response parsing and cancellation;
- a local editable system prompt;
- validated temperature, top-p, top-k, context, seed, and repeat-penalty parameters at the manager boundary;
- bounded roles, message count, message size, transcript size, and response size;
- conversation selection, new conversation, stop, regenerate, and export guidance;
- a persisted bounded metadata index containing identifiers, titles, model name, counts, and timestamps only.

Unexpected errors are sanitized before reaching the renderer. The persisted metadata API rejects message bodies and unknown fields. The current UI keeps attachments disabled unless the selected model reports a relevant capability, and it also states that capability alone is insufficient until a safe attachment-selection bridge exists.

## Harness profiles, snapshots, and restore

Harness launch is a Material Encryption feature layered around local tools; Ollama does not natively provide this launcher.

The surface lists prebuilt profiles returned by the bridge and discovered from known local Ollama installation paths. The manager can also validate explicitly reviewed profile records at its internal call boundary, but the current UI does not claim a general profile-registration editor. A profile declares:

- a stable identifier and label;
- one allowlisted installed executable;
- bounded argument templates with declared placeholders;
- bounded configuration mutations inside allowlisted roots.

Before launch, the application exposes a preview and preflight for the exact executable, arguments, and configuration changes. Processes launch directly with `shell: false`, hidden window behavior, and no arbitrary command box.

For profiles that modify configuration, the manager snapshots every allowlisted target before mutation. A successful launch returns a restorable snapshot record. A failed launch automatically restores the snapshot before reporting failure. The Restore surface accepts only a valid recorded snapshot identifier and restores only the recorded files; it never guesses a rollback.

## Privacy and secrets

- Runtime traffic stays on the fixed loopback Ollama endpoint. Official catalog refresh is the only non-loopback Ollama Studio request and is limited to the official HTTPS registry origin.
- The renderer receives validated records and safe messages, not arbitrary paths, URLs, commands, response bodies, or environment data.
- Processes are never launched through a shell. Executables, arguments, placeholders, and configuration roots are allowlisted and bounded.
- Chat history persistence stores bounded metadata only. Prompts and responses are not accepted by that persistent metadata record.
- Snapshots contain only the reviewed configuration files needed for restore. Errors do not echo private paths, tokens, configuration content, or unexpected exception text to the renderer.
- No payment, account, telemetry, cloud synchronization, or arbitrary online documentation flow is part of Ollama Studio.

## Failure modes and guided recovery

| State | In-app recovery |
|---|---|
| Desktop bridge missing | Open Settings → Update or repair the application, then return and detect the runtime again |
| Ollama service stopped or unhealthy | Use runtime discovery and the reviewed local-service profile where available, then rerun checks |
| No installed chat model | Open Model Store, add a suitable variant to Download Cart, complete the pull, then select it in chat |
| Official catalog offline | Continue with the visibly stale last validated cache when present; retry refresh later |
| Catalog malformed or pagination unsafe | Reject the refresh; retain the last valid cache without partially applying the response |
| Hardware or model evidence incomplete | Show **Unknown** with the missing evidence instead of recommending by guess |
| Insufficient disk | Skip the pull before transfer and show the required-versus-available evidence |
| Pull or chat stream malformed/incomplete | Stop with a stable error; retain completed/partial outcomes and offer retry or recovery |
| Harness unavailable | Show the missing executable/profile condition and refresh after the named local prerequisite is restored |
| Harness launch fails | Restore the pre-launch configuration snapshot automatically, then report the failure |
| Snapshot is not restorable | Disable Restore and require a refreshed recorded snapshot; never invent rollback state |

The bundled offline help is the canonical recovery path. It does not send the user to an unspecified online page.

## Verification

`tests/ollama-manager.test.mjs` declares 10 tests covering:

- exact loopback endpoint validation;
- fixed local routes and safe model detail parsing;
- redirect rejection and malformed/incomplete streams;
- fragmented UTF-8 progress, chat streaming, and cancellation;
- bounded cart concurrency, partial outcomes, and disk preflight;
- complete same-origin catalog/tag pagination;
- unsafe pagination rejection and stale validated cache fallback;
- conservative fit verdicts and Unknown handling;
- discovery, preview, direct launch, rollback, restore boundaries, and no-payment semantics;
- bounded metadata-only chat history and sanitized unexpected failures.

The current capture directory contains no Ollama Studio image. A genuine packaged Ollama Studio capture and a refreshed all-destination matrix remain required before runtime capture or release completion is claimed.

## Suggested articles

- [Ollama index](README.md)
- [Local File Converter](../tools/file-converter.md)
- [Security architecture](../security/README.md)
- [Build and release](../release/README.md)
