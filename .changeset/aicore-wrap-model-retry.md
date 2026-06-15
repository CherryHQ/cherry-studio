---
'@cherrystudio/ai-core': patch
---

Add a `wrapModel` hook on `createAgent` (`CreateAgentOptions.wrapModel`) so callers can wrap the fully-resolved language model (after middleware) as the outermost layer — used for retry/fallback. Also exports a `resolveLanguageModel(providerId, providerSettings, modelId)` helper to instantiate a language model for any provider through the standard plugin pipeline.
