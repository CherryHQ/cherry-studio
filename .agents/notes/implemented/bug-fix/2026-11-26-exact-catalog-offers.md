# Agent Note: Preserve exact model offers in catalog refreshes

Status: implemented

English | [中文](2026-11-26-exact-catalog-offers.zh.md)

## Problem

A daily refresh deduplicated offers by canonical model ID. When a paid route and a free variant shared that ID, the generated catalog could keep the free price while the application still sent the paid request ID.

## Decision

Keep prices and limits on the exact vendor offer. Canonical lookup prefers the unsuffixed offer when the provider spells it with a namespace or different version separators. Exact lookup resolves tagged offers independently.

CherryIN indexes priced offers by their exact API IDs and uses the provider's price as a complete schedule. The provider declarations preserve published fixed prices and context-length tiers. The desktop estimates eight weekday-priced DeepSeek routes at request completion and uses duration-specific rates for Claude Haiku 5.5 and the two Kimi K3.1 Pro routes. Their flat catalog rates stay unset. Modality pricing expressions remain unpriced.

The CherryIN Chat Completions adapter reads the `cherryin` SDK option namespace. Qwen4 Max uses `enable_thinking` and `reasoning_effort` on Chat Completions, and `thinking.type` or `output_config.effort` on Messages.

The Chat Completions adapter caps non-thinking Qwen4 Max requests at 131,072 output tokens. CherryIN Messages accepts a `max_tokens` request value of 262,144 even with thinking disabled. This confirms request validation, while the native model specification describes the underlying generation limits. [Alibaba Cloud Qwen4 Max specifications](https://www.alibabacloud.com/help/en/model-studio/qwen4-max)

The daily workflow checks the generated catalog before updating its pull request and includes changed model data and tool indexes together. Full refreshes keep previously reviewed base models while generated offers still reference them. When a declared provider template has no fresh listing, its previous offer supplies the exact request ID and pricing. OpenCode Go offers use declared protocol settings first, then the supported upstream SDK protocol or Chat Completions. The generator publishes upstream reasoning controls only for models the reasoning rules recognize.

## Alternatives considered

Keeping one row per canonical model loses independently callable offers. Selecting the first row makes pricing depend on upstream array order.

## Consequences

The catalog can serve multiple exact offers for one model. A candidate that violates an existing catalog contract needs a source correction before automation can update the pull request.

## Verification

- Regression — `catalog-invariants.test.ts`: paid and free Nemotron routes keep their own prices and canonical lookup is independent of row order.
- Regression — `alibaba-catalog.test.ts`: Qwen4 Max keeps the native output limit and the OpenRouter route uses its own limit and reasoning settings.
- Regression — `registry.test.ts` and `ProviderRegistryService.test.ts`: CherryIN's prices and tier boundaries stay on the exact routes. An unsupported expression cannot pick up cache prices from the base model.
- Regression — `reasoningMembership.test.ts` and `ProviderRegistryService.test.ts`: Gemini 2.5 Flash Image keeps image generation and a 32,768-token output limit without exposing thinking controls. [Google model specifications](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-image)
- Regression — `providerBilling.integration.test.ts`: CherryIN applies the off-peak rate at completion and prices complete cache-duration splits without changing recorded token counts. Incomplete splits leave cost unset.
- Regression — `providerBilling.integration.test.ts`: Haiku 5.5 selects its published tier using total input, and both Kimi K3.1 Pro routes apply their separate one-hour rates.
- Regression — `cherryin-provider.test.ts` and `providerBilling.integration.test.ts`: Gemini chat and image generation send the full CherryIN route ID, and Gemini tool prompt tokens count towards input usage and cost.
- Regression — `providerBilling.integration.test.ts`: CherryIN Gemini audio and image tokens use their published rates. A missing modality split leaves cost unset.
- Regression — `providerBilling.integration.test.ts`: CherryIN GPT Image generation and editing retain the input-image and cached-token counts and apply the published formula once per request.
- Production smoke, 2026-11-26 — CherryIN's native Gemini endpoint accepted the namespaced Flash, Flash-Lite, and Flash Image IDs. The audio response reported 13 audio input tokens and the image response reported 1,290 image output tokens in their modality breakdowns.
- Regression — `gatewayUsageNormalize.test.ts` and `providerBilling.integration.test.ts`: Chat Completions and Responses cache-write aliases count once and displace uncached input.
- Regression — `providerBilling.integration.test.ts`: desktop requests preserve Qwen4 Max reasoning controls through both protocols.
- Production smoke, 2026-11-26 — Chat Completions accepted `off`, `low`, `high`, and `xhigh`. Messages accepted the same modes and rejected `max_tokens: 262145`. Thinking streams returned answer text for the complete-sentence prompt, while the digits-only prompt ended without a text block. The non-streaming Messages response included the digits.
- Regression — full catalog generation with captured and refreshed upstream inputs: the catalog checks cover request IDs, reference integrity, OpenCode Go endpoints and reasoning membership.
