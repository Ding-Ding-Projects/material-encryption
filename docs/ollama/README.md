# Ollama

This category documents Material Encryption's independent local Ollama management surface.

## Articles

- [Ollama Studio](ollama-studio.md) — runtime discovery, official catalog and variants, PC-fit evidence, downloads, chat, harness profiles, restore, privacy, failure modes, and verification.

## Boundary summary

- Runtime operations use only the fixed local endpoint `http://127.0.0.1:11434` and an allowlist of documented Ollama API routes.
- Official model discovery uses bounded HTTPS requests to `https://registry.ollama.ai`, follows only same-origin catalog/tag pagination, and falls back to a validated cached inventory while offline.
- Model downloads are free local pulls. The Download Cart never collects payment or opens a checkout.
- Harness launch is a profile-based application feature layered around Ollama; it is not presented as an Ollama-native harness launcher and never accepts arbitrary shell input.

## Suggested articles

- [Ollama Studio](ollama-studio.md)
- [Security architecture](../security/README.md)
- [Complete local suite inventory](../release/local-suite-inventory.md)
