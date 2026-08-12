# Tools

This category documents local tools that operate on user-selected data without becoming cryptographic engines or general-purpose shell surfaces.

## Articles

- [Local File Converter](file-converter.md) — categorized adapters, PDF operations, persistent queue, privacy boundaries, failure modes, and verification.

## Shared boundaries

- Tools receive paths only from native selection flows and expose opaque capabilities to the renderer.
- Enabled adapters must be bundled and work offline; unavailable formats remain visible with the exact missing adapter or reason.
- Inputs, outputs, temporary storage, records, and concurrency are bounded. Source files remain unchanged unless an explicitly reviewed operation says otherwise.
- Output is validated before success is reported. Network services, arbitrary executables, shell commands, and VeraCrypt credentials are outside the converter boundary.

## Suggested articles

- [Security architecture](../security/README.md)
- [Ollama Studio](../ollama/ollama-studio.md)
- [Complete local suite inventory](../release/local-suite-inventory.md)
