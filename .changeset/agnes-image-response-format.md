---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Drop `response_format: 'b64_json'` for custom image models (`agnes-image-*`, `agnes-t2i-*`) in `@ai-sdk/openai`.

The OpenAI image generation API accepts both `b64_json` (base64) and `url` response formats. Before this change, the SDK always forced `response_format: 'b64_json'` for models not listed in `defaultResponseFormatPrefixes`, including custom Agnes image models. Since `@ai-sdk/openai`'s `openaiImageResponseSchema` only accepted `b64_json`, any Agnes response returning a `url` would fail with `InvalidResponseDataError`.

Changes:
- Patch `@ai-sdk/openai@3.0.53` to add `agnes-image-*` and `agnes-t2i-*` to `defaultResponseFormatPrefixes`, so the SDK stops injecting `response_format: 'b64_json'` for these models (mirroring the OpenAI-compatible patch).
- Widen `openaiImageResponseSchema` to accept both `b64_json` and `url` on each data item (matching the existing OpenAI-compatible patch behavior).
- Update the image result mapping to fall back to `url` when `b64_json` is absent.
