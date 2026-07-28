---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Fix `Unknown parameter: 'response_format'` when generating images with `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, or `chatgpt-image-*` through any provider that routes the image model via `OpenAICompatibleImageModel` (e.g. `openai-compatible` typed providers and the AiHubMix / NewAPI / CherryIN gateways in this repo).

`OpenAICompatibleImageModel.doGenerate` unconditionally added `response_format: "b64_json"` to `/images/generations` bodies. The previous `@ai-sdk/openai@3.0.53` patch only covered `OpenAIImageModel` (direct OpenAI + Azure via `@ai-sdk/azure`), so users on the compatible route (AiHubMix, NewAPI, CherryIN, generic openai-compatible) kept hitting this 400 on newer gpt-image models. Extended `patches/@ai-sdk__openai-compatible@2.0.37.patch` with the same `hasDefaultResponseFormat` guard used upstream by `@ai-sdk/openai`. Drop the addition once `@ai-sdk/openai-compatible` ships the equivalent check.
