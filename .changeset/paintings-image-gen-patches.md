---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Wire the v2 paintings image-generation path through patched AI SDK image models:

- Activate the `ai@6.0.143` patch (adds the `experimental_download` option to
  `generateImage`) so HTTP(S) image outputs are classified and downloaded by
  the SDK while data-URL outputs pass through untouched.
- Extend the `@ai-sdk/openai-compatible` patch to support `url`-field image
  responses and skip the `response_format` parameter for `gpt-image-*` models.
- Extend the `@ai-sdk/google` patch with model-path / `isGeminiModel` prefix
  handling for Gemini/Imagen image models.

These are targeted shims for the OpenAI-compatible / Google image gateways used
by the painting providers; non-image OpenAI-compatible calls are unaffected.
