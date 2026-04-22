---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Support OpenAI `gpt-image-2`:

- Bump `@ai-sdk/openai` peer/dependency range to `^3.0.53`.
- Patch `@ai-sdk/openai@3.0.53` to add `gpt-image-2` to `modelMaxImagesPerCall` and `defaultResponseFormatPrefixes`, mirroring vercel/ai#14680 / #14682 (backport to `release-v6.0`). Without the patch the provider sends `response_format: 'b64_json'` to `gpt-image-2`, which OpenAI rejects with `400 Unknown parameter: 'response_format'`. Drop the patch once `@ai-sdk/openai@3.0.54+` publishes.
