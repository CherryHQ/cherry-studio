# @cherrystudio/ai-sdk-provider

## 0.1.7

### Patch Changes

- [#14578](https://github.com/CherryHQ/cherry-studio/pull/14578) [`26d877e`](https://github.com/CherryHQ/cherry-studio/commit/26d877e0fadc38a08da5ae888f4c9661038556c5) Thanks [@DeJeune](https://github.com/DeJeune)! - Fix CherryIN image-edit requests failing with `invalid character '-' in numeric literal`.

  The JSON headers getter hard-coded `Content-Type: application/json`, which leaked into `OpenAICompatibleImageModel`'s `/images/edits` call. That path uses `postFormDataToApi` and relies on `fetch` to auto-set `multipart/form-data; boundary=...`; forcing JSON made the server try to parse the multipart body as JSON and choke on the leading `--boundary`. Removed the explicit `Content-Type` — `postJsonToApi` still defaults it for JSON endpoints.

- [#14488](https://github.com/CherryHQ/cherry-studio/pull/14488) [`c0b3c88`](https://github.com/CherryHQ/cherry-studio/commit/c0b3c880e3b3846cf457648f3ed826b5e0f4e508) Thanks [@DeJeune](https://github.com/DeJeune)! - Support OpenAI `gpt-image-2`:

  - Bump `@ai-sdk/openai` peer/dependency range to `^3.0.53` and refresh all other first-party `@ai-sdk/*` packages to their current `latest` (anthropic `^3.0.71`, azure `^3.0.54`, amazon-bedrock `^4.0.96`, cerebras `^2.0.45`, cohere `^3.0.30`, gateway `^3.0.104`, google `^3.0.64`, google-vertex `^4.0.112`, groq `^3.0.35`, huggingface `^1.0.43`, mistral `^3.0.30`, perplexity `^3.0.29`, togetherai `^2.0.45`, xai `^3.0.83`). Re-port `@ai-sdk/google` patch (`getModelPath`) to 3.0.64; keep `@ai-sdk/openai-compatible` on its currently-patched version. Narrow `getAnthropicReasoningParams` return so the new `xhigh` effort from `@ai-sdk/anthropic@3.0.71` does not leak into `AgentSessionContext.effort`.
  - Pin `@ai-sdk/provider-utils` to `4.0.23` via `pnpm.overrides` so the rest of the `@ai-sdk/*` tree resolves a single provider-utils, avoiding a TS2742 portability error in `coreExtensions`' declaration emit.
  - Patch `@ai-sdk/openai@3.0.53` to add `gpt-image-2` to `modelMaxImagesPerCall` and `defaultResponseFormatPrefixes`, mirroring vercel/ai#14680 / #14682 (backport to `release-v6.0`). Without the patch the provider sends `response_format: 'b64_json'` to `gpt-image-2`, which OpenAI rejects with `400 Unknown parameter: 'response_format'`. Drop the patch once `@ai-sdk/openai@3.0.54+` publishes.
  - Widen `ToolFactoryPatch.tools` from `ToolSet` to `Record<string, any>`. The tightened `Tool<INPUT, OUTPUT>` generics in `@ai-sdk/openai@3.0.53` (e.g. `webSearch` / `webSearchPreview`) no longer collapse to the `ToolSet` union. Runtime is a shallow copy into `params.tools`, so the shape is equivalent.

- [#14578](https://github.com/CherryHQ/cherry-studio/pull/14578) [`26d877e`](https://github.com/CherryHQ/cherry-studio/commit/26d877e0fadc38a08da5ae888f4c9661038556c5) Thanks [@DeJeune](https://github.com/DeJeune)! - Fix `Unknown parameter: 'response_format'` when generating images with `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, or `chatgpt-image-*` through any provider that routes the image model via `OpenAICompatibleImageModel` (e.g. `openai-compatible` typed providers and the AiHubMix / NewAPI / CherryIN gateways in this repo).

  `OpenAICompatibleImageModel.doGenerate` unconditionally added `response_format: "b64_json"` to `/images/generations` bodies. The previous `@ai-sdk/openai@3.0.53` patch only covered `OpenAIImageModel` (direct OpenAI + Azure via `@ai-sdk/azure`), so users on the compatible route (AiHubMix, NewAPI, CherryIN, generic openai-compatible) kept hitting this 400 on newer gpt-image models. Extended `patches/@ai-sdk__openai-compatible@2.0.37.patch` with the same `hasDefaultResponseFormat` guard used upstream by `@ai-sdk/openai`. Drop the addition once `@ai-sdk/openai-compatible` ships the equivalent check.

- [`1f86774`](https://github.com/CherryHQ/cherry-studio/commit/1f867749b8b2a3325813b6fac4dbc0d77f93516b) Thanks [@DeJeune](https://github.com/DeJeune)! - Support Claude Opus 4.7:

  - Bump `@ai-sdk/anthropic` peer/dependency range to `^3.0.71`, which adds the `claude-opus-4-7` model id, native `xhigh` reasoning effort, `display` on adaptive thinking, and `taskBudget`.
  - Widen `ToolFactoryPatch.tools` from `ToolSet` to `Record<string, any>`. The tightened `Tool<INPUT, OUTPUT>` generics in `@ai-sdk/anthropic@3.0.71` (e.g. `webSearch_20260209` returns `Tool<{ query: string }, { type: 'web_search_result', ... }[]>`) are no longer assignable to `ToolSet`'s `Tool<any,any>|Tool<any,never>|Tool<never,any>|Tool<never,never>` union-with-`Pick` intersection. Runtime is a shallow copy into `params.tools`, so the shape is equivalent.

## 0.1.6

### Patch Changes

- [#12783](https://github.com/CherryHQ/cherry-studio/pull/12783) [`336176b`](https://github.com/CherryHQ/cherry-studio/commit/336176be086c8294d9aa21da9ce83242af8aa9a8) Thanks [@EurFelux](https://github.com/EurFelux)! - Baseline release for previously unmanaged package changes while introducing changesets-based publishing
