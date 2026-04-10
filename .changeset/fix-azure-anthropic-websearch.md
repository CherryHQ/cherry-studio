---
'@cherrystudio/ai-core': patch
---

fix(providers): azure-anthropic variant uses correct Anthropic toolFactories for web search

- Add `TOutput` generic to `ProviderVariant` so `transform` output type flows to `toolFactories` and `resolveModel`
- Add Anthropic-specific `toolFactories` to `azure-anthropic` variant (fixes `provider.tools.webSearchPreview is not a function`)
- Fix `urlContext` factory incorrectly mapping to `webSearch` tool key instead of `urlContext`
- Fix `BedrockExtension` `satisfies` type to use `AmazonBedrockProvider` instead of `ProviderV3`
