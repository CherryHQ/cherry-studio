---
'@cherrystudio/ai-core': patch
---

Remove the prompt-based tool-use plugin end-to-end. Tool use now relies solely on native provider tool calling, so `promptToolUsePlugin` (with its `StreamEventManager`, `ToolExecutor`, and tag-extraction helpers) and the public exports `ToolUseRequestContext` and `AiRequestMetadata.isPromptToolUse` are gone. Also switch the provider cache from `lru-cache` to `quick-lru`.
