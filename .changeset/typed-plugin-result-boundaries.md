---
"@cherrystudio/ai-core": major
---

BREAKING: `AiPlugin.onError` receives `unknown` instead of `Error`. Narrow the original rejection before reading Error fields. Rejection values are forwarded without wrapping and rethrown when hooks complete normally; hook failures still propagate instead, and undefined rejections retain their existing notification suppression. `PluginManager.executeFirst` now infers its real result from the hook name instead of accepting an unchecked result type argument. Model resolvers must return the requested modality. Language middleware requires a V3 language model; V2 language models remain supported by text and stream execution without middleware.
