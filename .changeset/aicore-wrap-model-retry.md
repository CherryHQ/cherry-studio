---
'@cherrystudio/ai-core': patch
---

Add a `wrapModel` hook so callers can wrap the fully-resolved model (after middleware) as the outermost layer — used for retry/fallback. Exposed on `createAgent` (`CreateAgentOptions.wrapModel`) for language models and on `RuntimeExecutor.embedMany` / `EmbedManyParams.wrapModel` for embedding models. Also exports a `resolveLanguageModel(providerId, providerSettings, modelId)` helper to instantiate a language model for any provider through the standard plugin pipeline.
