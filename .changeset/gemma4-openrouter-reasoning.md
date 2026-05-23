---
'@cherrystudio/ai-core': patch
---

Enable Gemma 4 thinking support in OpenRouter:

- Add `isOpenRouterGemma4ThinkingModel` helper function to detect Gemma 4 models in OpenRouter
- Update `_getThinkModelType` to assign `gemma4_hosted` type to OpenRouter Gemma 4 models
- OpenRouter Gemma 4 models (27B and 31B) now support thinking capability toggle and reasoning effort adjustment (minimal/high)
