---
'@cherrystudio/ai-core': patch
---

Fix `Unknown parameter: 'response_format'` for Agnes AI image models through OpenAI-compatible route.

`OpenAIImageModel.doGenerate` and `OpenAICompatibleImageModel.doGenerate` both hardcode `response_format: "b64_json"` on `/images/generations` requests. The existing `hasDefaultResponseFormat` guard only whitelisted OpenAI's gpt-image-* / chatgpt-image-* models. Models from Agnes AI (agnes-image-2.1-flash, agnes-t2i-general-model) are not known to have a default response format and return 400 when the client sends the parameter — which is exactly what the painting panel did.

Added `agnes-image-` and `agnes-t2i-` to `defaultResponseFormatPrefixes` in both `patches/@ai-sdk__openai@3.0.53.patch` and `patches/@ai-sdk__openai-compatible@2.0.62.patch`. This makes the guard return true for these models, omitting the unsupported parameter.

Refs #18323.
