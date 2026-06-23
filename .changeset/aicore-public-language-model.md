---
'@cherrystudio/ai-core': patch
---

Expose `RuntimeExecutor.languageModel(modelId)` as public API so callers can resolve a `LanguageModelV3` through the same path the agent uses; the private `resolveModel` now delegates to it (behavior-preserving). Consumed by the app's context-build compression-model resolver.
