---
'@cherrystudio/ai-core': patch
'@cherrystudio/ai-sdk-provider': patch
---

Support OpenAI `gpt-image-2`:

- Bump `@ai-sdk/openai` peer/dependency range to `^3.0.53` and `@ai-sdk/azure` to `^3.0.54` so both consume `@ai-sdk/provider-utils@4.0.23`.
- Pin `@ai-sdk/provider-utils` to `4.0.23` via `pnpm.overrides` so the rest of the `@ai-sdk/*` tree resolves a single provider-utils, avoiding a TS2742 portability error in `coreExtensions`' declaration emit.
- Patch `@ai-sdk/openai@3.0.53` to add `gpt-image-2` to `modelMaxImagesPerCall` and `defaultResponseFormatPrefixes`, mirroring vercel/ai#14680 / #14682 (backport to `release-v6.0`). Without the patch the provider sends `response_format: 'b64_json'` to `gpt-image-2`, which OpenAI rejects with `400 Unknown parameter: 'response_format'`. Drop the patch once `@ai-sdk/openai@3.0.54+` publishes.
- Widen `ToolFactoryPatch.tools` from `ToolSet` to `Record<string, any>`. The tightened `Tool<INPUT, OUTPUT>` generics in `@ai-sdk/openai@3.0.53` (e.g. `webSearch` / `webSearchPreview`) no longer collapse to the `ToolSet` union. Runtime is a shallow copy into `params.tools`, so the shape is equivalent.
