# Security architecture

The renderer runs with `contextIsolation`, sandboxing, and Node.js integration disabled. A small preload bridge exposes named operations only. The main process validates all renderer input again and launches VeraCrypt with `shell: false` and an explicit argument array.

## Features

- [Independent element toy locks](toy-locks.md)

Volume passwords and token PINs are never accepted by the bridge. VeraCrypt's own secure prompt handles them. External navigation is denied in the application and only allowlisted HTTPS links may open in the system browser.

## Failure modes

- Missing VeraCrypt: operation fails with an install recovery message.
- Invalid volume or drive: operation is refused before process creation.
- VeraCrypt refusal: bounded error text is reported without dumping credentials or environment data.
- Renderer compromise: the exposed bridge cannot run arbitrary commands, read arbitrary files, or choose an executable.

## Verification

Run `npm run test:security` and `npm test`. Runtime verification must inspect the packaged app, its CSP console, its preload surface, and the exact child-process arguments without recording user secrets.
