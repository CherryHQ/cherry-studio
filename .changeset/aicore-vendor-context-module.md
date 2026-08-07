---
'@cherrystudio/ai-core': minor
---

Vendor the consumed slice of `@context-chef/*` (MIT, same author) as a new platform-neutral `core/context` module, and drop the external dependency. Public surface: `createContextMiddleware` (tool-result truncation via a pluggable `VFSStorageAdapter`, mechanical compaction, budget guard with `onBeforeCompress`), `compactModelMessages` / `summarizeModelMessages` (durable + in-loop LLM compaction primitives), and `ContextPrompts` (truncation-marker / summary-wrapper contracts). Trimmed relative to upstream: no in-flight LLM compress, skills, dynamic state, placeholder clearing, custom tokenizers, or VFS read-back/cleanup — storage lifecycle stays host-owned. The node-only `FileSystemAdapter` moved to the main process (`VfsBlobService`).
