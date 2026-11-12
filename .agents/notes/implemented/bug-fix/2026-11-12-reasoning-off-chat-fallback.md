# Agent Note: Preserve reasoning Off semantics on chat fallback

Status: implemented

English | [中文](2026-11-12-reasoning-off-chat-fallback.zh.md)

## Problem

Sonnet 5.5 uses `adaptive-between-tools`: native Off means `thinking.type: 'between_tools'`, its lowest tier rather than a disable. The generic chat fallback translates Off into `reasoningEffort: 'none'`. Endpoints requiring reasoning reject that disable with HTTP 400 (#24260).

## Decision

`resolveReasoningProfileFromRegistry` removes `off` only from the last-resort `openai-chat` wire for `adaptive-between-tools`. Authored `contract.wire` and `format.wire` retain precedence. Native Anthropic keeps `between_tools`; Responses, Ollama, Gemini, budget, effort and adaptive-always behavior remains unchanged. The source profile is not mutated; a wire already lacking Off retains its identity.

Runtime projection excludes `none` while retaining explicit tiers. A stored `none` selection emits no automatic reasoning parameters and leaves the endpoint default in control. This does not promise a particular server default or a successful live response.

## Alternatives considered

- Clamp Off to the lowest tier: a model's lowest declared tier does not establish what the endpoint accepts and would introduce a new effort policy.
- Drop Off across all formats: Responses, Ollama and Gemini have distinct supported Off mappings; the reported chat failure does not justify removing them.

## Consequences

The explicit-disable request from #16903 for OpenAI-compatible Claude no longer applies to this family on chat, including accepting endpoints. Authored wires can still declare Off. Catalog-backed IDs and custom rows whose dialect is recovered from `apiModelId` receive this policy; genuine ID-pattern misses keep generic behavior. Provider metadata fallback from #23615 and failure classification from #12088 remain separate.

## Verification

- AC1 — `node node_modules/vitest/vitest.mjs run --project main src/main/data/services/__tests__/ProviderRegistryService.test.ts`: custom-ID vocabulary, omission, native, budget, GPT and authored-wire contracts; RED captured before implementation.
- AC2 — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`: captured SDK bodies omit `reasoning_effort` for stored `none`, retain model and messages, and send explicit `high`; RED captured before implementation.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/utils/__tests__/reasoningSerializers.test.ts`: serializer contracts.
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/features/apiGateway/adapters/__tests__/providerOptionsMapper.test.ts`: gateway contracts.
- Regression — `node node_modules/vitest/vitest.mjs run --project provider-registry`: unchanged package contracts.
- Regression — `pnpm docs:check`: links, note format and bilingual pairing for this note (green on this branch).
