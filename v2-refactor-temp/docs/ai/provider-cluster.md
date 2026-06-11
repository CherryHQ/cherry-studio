# Provider Resolution — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/provider/` | `config.ts` (495), `endpoint.ts` (99), `factory.ts` (17), `constants.ts` (14) | Provider config builder, endpoint resolver, derived helpers |
| `provider/extensions/` | `index.ts` (236) | All `ProviderExtension.create(...)` registrations |
| `provider/custom/` | `aihubmix-provider.ts` (167), `newapi-provider.ts` (151) | Aggregator-provider implementations |
| `provider/` | `listModels.ts` (559), `listModelsSchemas.ts` (232), `listModels/vertex.ts` | Per-provider model listing |
| Tests | `__tests__/endpoint.test.ts` (307) | Resolver coverage |

## Intent

v1 picked the `@ai-sdk/*` package by sniffing `provider.id`,
`provider.type`, and `apiHost`. That worked for one-endpoint providers
and broke for multi-endpoint relays (MiniMax, Silicon, AiHubMix —
openai-chat-completions AND anthropic-messages under the same provider
id). The most visible symptom was `<think>` tags leaking into translate
output because an OpenAI-shape request hit an anthropic-format endpoint.

v2 introduces an explicit `adapterFamily` field per endpoint, computed
once at row-write time, read at request time. The full design is in
[adapter-family.md](./adapter-family.md) and the reference at
[`docs/references/ai/adapter-family.md`](../../../docs/references/ai/adapter-family.md).

This cluster bundles the resolver + the SDK-package wiring (extensions
and custom providers). Claude Code is not a generic provider extension;
it is only entered through the agent-session runtime.

## Key changes

### `endpoint.ts` (resolver)

Three pure functions:

- `resolveEffectiveEndpoint(provider, model)` — picks endpointType from
  `model.endpointTypes[0]` or `provider.defaultChatEndpoint`.
- `resolveProviderVariant(baseProviderId, endpointType)` — appends
  `-chat` / `-responses` suffix when ai-core registers a variant.
- `resolveAiSdkProviderId(provider, endpointType)` — the 6-line
  production resolver. Reads `endpointConfigs[ep].adapterFamily`, applies
  variant, falls back to `openai-compatible`.

54 test cases in `__tests__/endpoint.test.ts`.

### `config.ts` (provider-to-SDK config)

`providerToAiSdkConfig(provider, model)` builds the
`{ providerId, providerSettings }` pair. Per-id branches build the
SDK-specific settings shape:

- `openai`, `anthropic`, `google`, `azure`, etc. — standard apiKey +
  baseURL + headers.
- `gateway` — async, model-list dependent.
- `aihubmix` / `newapi` — pass through to the custom provider factories.

### Provider extensions

`provider/extensions/index.ts` registers every `@ai-sdk/*` package
Cherry uses via `ProviderExtension.create(...)`. Each registration
declares:

- `name`, `aliases`, `variants`
- `create` (the SDK factory)
- `toolFactories` (per-capability factories for `webSearch`,
  `urlContext`, etc.) — see the registry tool-capability section in
  [`docs/references/ai/core-architecture.md`](../../../docs/references/ai/core-architecture.md).
- `supportsImageGeneration` flag

### Custom providers

- **aihubmix** (`provider/custom/aihubmix-provider.ts`) — relay across
  OpenAI / Anthropic / Google. Each model row carries
  `model.provider = "aihubmix.<vendor>"`; the registry's aggregator
  fallback in `resolveToolCapability` uses the suffix to find the right
  `toolFactory`.
- **newapi** — same shape, different relay backend.

### Claude Code runtime helpers

Claude Code no longer registers a normal AI SDK provider extension.
The Claude-specific runtime pieces live under
`src/main/ai/runtime/claudeCode/`: the driver owns the
SDK query, warm query reuse, SDK input queue, and stream adapter that
converts agent SDK events into UI message chunks. `settingsBuilder.ts`
builds `ClaudeCodeSettings` from an `AgentSessionEntity` — model
selection, MCP server configs, allowed-tools list, prompt builder, proxy
env, and OS shell quirks. `agentSessionWarmup.ts` then turns those
settings into SDK query options using the agent session, provider,
model, and latest persisted SDK session id.

### `listModels.ts`

Per-provider model listing — fans out to OpenAI's `/models`, Anthropic's
hardcoded list, Gemini's `models.list`, etc., normalises to the
`Model[]` shape. `listModelsSchemas.ts` carries Zod schemas for the per-
provider response bodies.

## Invariants

- The resolver never reads `apiHost` to pick an adapter. Only
  `adapterFamily` and `endpointType`.
- Adding a new provider means: (a) register the extension, (b) add it
  to `providerToAiSdkConfig`'s branch, (c) add the
  `adapterFamily` per endpoint in `providers.json`. No other touchpoint.
- `claude-code` runtime's `buildClaudeCodeSessionSettings` is the only path that
  reads agent session data — it must throw on orphan sessions
  (`agentId === null`) rather than fall back to defaults.

## Validation

- `__tests__/endpoint.test.ts` — 54 cases incl. MiniMax regression,
  variant suffix application, unknown-family degradation
- Catalog tests in
  `packages/provider-registry/src/__tests__/registry-utils.test.ts`
- Migrator tests in
  `src/main/data/migration/v2/migrators/mappings/__tests__/ProviderModelMappings.test.ts`

## Follow-ups (out of scope)

- The UI custom-provider form is queued — `inferAdapterFamily` is in
  place; UI wiring is one line when the form lands.
- `claude-code` retry on transient SDK errors — currently surfaces
  errors directly.
