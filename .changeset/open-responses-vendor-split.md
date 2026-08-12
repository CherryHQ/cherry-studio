---
'@cherrystudio/ai-sdk-provider': patch
---

Vendor-split CherryIN Responses model creation: OpenAI-vendor ids stay on `OpenAIResponsesLanguageModel`, all other vendors route through `@ai-sdk/open-responses` (spec-neutral dialect with reasoning replay). Removes the unused `provider.responses` surface.
