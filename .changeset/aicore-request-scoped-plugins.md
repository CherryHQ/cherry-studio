---
'@cherrystudio/ai-core': patch
---

Scope the executor's internal resolver plugins to each request. `RuntimeExecutor` no longer mutates `PluginEngine.basePlugins` (or the caller's `plugins` array) on every `streamText` / `generateText` / `generateImage` call, so a reused executor's plugin chain stays fixed and an image id resolved after a text call goes through `imageModel` again. Removed `RuntimeExecutor.createResolveModelPlugin()` and `createConfigureContextPlugin()`; use the new `executor.resolveLanguageModel(modelId)` instead (`createAgent` and the package-level `resolveLanguageModel` already do). `PluginEngine.resolveModel` and the three `execute*WithPlugins` methods accept an optional trailing `requestPlugins` argument.
