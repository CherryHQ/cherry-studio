# Agent Note: bf16.ai built-in provider

Status: proposed

English | [中文](2026-11-22-bf16-built-in-provider.zh.md)

## Problem

bf16.ai users currently configure a custom OpenAI-compatible connection manually. Adding a bundled provider preset would make bf16.ai discoverable in the provider registry with accurate 1M-context limits, multimodal capabilities, tool calling metadata, and official branding out of the box.

## Proposal

Add a built-in `bf16` (`bf16.ai`) preset using the OpenAI-compatible Chat Completions endpoint at `https://api.bf16.ai/v1` (with `GET https://api.bf16.ai/v1/models` returning a standard OpenAI model list for dynamic discovery) and API key authentication (`BF16_API_KEY`). Register the five public uncensored 1M-context models (`zai-org/glm-5.3-uncensored`, `deepseek/deepseek-v4.1-flash-uncensored`, `deepseek/deepseek-v4.1-flash-uncensored-fast`, `zai-org/glm-5.3-flash-uncensored`, and `moonshotai/kimi-k3.1-pro-uncensored`) along with official light/dark SVG icons and locale labels.

All five models expose 1,048,576 context tokens, implicit prompt caching, tool calling, structured outputs, and reasoning effort controls (`none|low|high|max` on DeepSeek V4.1 Flash variants; `low|high|max` on GLM-5.3 and Kimi K3.1 Pro variants). Multimodal image input (`text+image->text`) is supported on `deepseek/deepseek-v4.1-flash-uncensored`, `deepseek/deepseek-v4.1-flash-uncensored-fast`, `zai-org/glm-5.3-flash-uncensored`, and `moonshotai/kimi-k3.1-pro-uncensored`. Current public per-million-token USD rates (input / cache read / output) are: DeepSeek V4.1 Flash Uncensored `0.26 / 0.045 / 1.00`, DeepSeek V4.1 Flash Uncensored Fast `0.28 / 0.055 / 1.12`, GLM-5.3 Flash Uncensored `0.30 / 0.065 / 1.12`, GLM-5.3 Uncensored `1.35 / 0.25 / 4.20`, and Kimi K3.1 Pro Uncensored `2.90 / 0.45 / 9.90`. Sources: [catalog](https://api.bf16.ai/v1/models), [docs](https://bf16.ai/docs), and [pricing](https://bf16.ai/pricing). No new runtime transport, storage schema change, or shared canonical model modification is proposed.

## Alternatives considered

A custom OpenAI-compatible connection already works today and can fetch model IDs from `GET /v1/models`, but users still must enter the base URL manually and do not receive pre-populated 1M context limits, multimodal vision flags, reasoning effort profiles, per-million-token pricing metadata, or official brand icons. Editing shared canonical lab models would misattribute bf16.ai pricing and uncensored variants to upstream lab providers.

## Acceptance criteria

- AC1 — Provider registry lists `bf16` (`bf16.ai`) with base URL `https://api.bf16.ai/v1` and dynamic model listing support while leaving sibling providers unchanged (verification: unit)
- AC2 — Default model metadata preserves 1,048,576 context limits, multimodal vision flags, tool-calling capabilities, and published per-million-token USD pricing without modifying canonical lab models (verification: unit)
- AC3 — Official monochrome/light/dark SVG icons, both the bulk provider icon catalog loader and per-icon provider lookup loader in `packages/ui/src/components/icons/loader.ts`, and all locale translation files pass icon and i18n registry tests (verification: unit)
- AC4 — Isolated desktop session and request-level serialization checks verify model list loading, streaming chat with reasoning content, outgoing `reasoning_effort` values (including DeepSeek `none` and `max`, plus GLM-5.3/Kimi `low`/`high`/`max`), vision input, and tool calling against `https://api.bf16.ai/v1` without exposing credentials (verification: renderer)
- AC5 — Affected provider-registry, icon, and renderer checks pass on the implementation branch before merge (verification: unit)

## Risks

Provider pricing and model availability can evolve over time, so rates and live model IDs must be rechecked against `https://api.bf16.ai/v1/models` immediately before opening the implementation PR. Upstream approval of this proposal precedes implementation; this note does not claim approval or waive DCO signed-commit requirements.
