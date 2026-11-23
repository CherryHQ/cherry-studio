---
description: Endpoint resolution chain from provider.endpointConfigs and adapterFamily to the AI SDK provider id and variants
sources:
  - src/main/ai/provider/endpoint.ts
  - src/main/ai/provider/config.ts
  - packages/aiCore/src/core/providers/core/initialization.ts
---

# Provider Resolution

## The problem this solves

A request needs to know which `@ai-sdk/*` package to import, with which
settings, hitting which URL. Three pieces of state determine that:

| Field | Lives on | Example |
|---|---|---|
| `provider.id` | `Provider` row | `minimax`, `silicon`, `my-relay` |
| `endpointType` | `model.endpointTypes[0]` or `provider.defaultChatEndpoint` | `openai-chat-completions`, `anthropic-messages` |
| `adapterFamily` | `provider.endpointConfigs[endpointType].adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` |

`adapterFamily` is the actual SDK selector. `provider.id` is the user-facing
identity. `endpointType` is the protocol family. The mapping is written
once at provider-creation time; runtime resolution is read-only.

See [Adapter Family](./adapter-family.md) for the full design.

## Resolver

`src/main/ai/provider/endpoint.ts` exposes four pure helpers:

```ts
resolveEffectiveEndpoint(provider, model): { endpointType, baseUrl, providerOptionsKey? }
resolveProviderVariant(baseProviderId, endpointType): AppProviderId
resolveAiSdkProviderId(provider, endpointType): AppProviderId
resolveProviderOptionsKey(aiSdkProviderId, context): string
```

`resolveAiSdkProviderId` is the runtime hot-path entry. It reads
`provider.endpointConfigs[endpointType].adapterFamily`, applies the
variant suffix if the endpoint type has one, falls back to
`openai-compatible` when no family is set.

`resolveEffectiveEndpoint` also resolves registered multi-backend gateway routes
(AiHubMix and DMXAPI) once. The route supplies both the wire endpoint and the
`providerOptions` namespace used by that gateway's concrete model. The result is
carried through `SdkConfig`; reasoning encoders consume the resolved namespace
and never inspect provider or model ids themselves.

```ts
// Full resolver — 6 lines
export function resolveAiSdkProviderId(provider, endpointType) {
  const adapterFamily = endpointType
    ? provider.endpointConfigs?.[endpointType]?.adapterFamily
    : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  return appProviderIds['openai-compatible']
}
```

## Variants

Some bases expose variant ids (a different endpoint on the same base).
`resolveProviderVariant` knows two suffix rules and applies one only when
the resulting `<base>-<suffix>` id is actually registered — otherwise it
returns the base unchanged:

| Endpoint type | Suffix tried |
|---|---|
| `openai-chat-completions`, `ollama-chat` | `-chat` |
| `openai-responses` | `-responses` |

Variants registered today (declared in each provider extension's
`variants` array, `packages/aiCore/src/core/providers/core/initialization.ts`):

| Base | Variant id(s) |
|---|---|
| `openai` | `openai-chat` (the base `openai` is itself the Responses API) |
| `azure` | `azure-responses`, `azure-anthropic` |
| `xai` | `xai-responses` |
| `cherryin` | `cherryin-chat` |

`ollama` has no registered variant, so an `ollama-chat` endpoint resolves
to the base `ollama`. Likewise there is **no `openai-responses` variant**
(the base already is) — and the standalone `open-responses` extension
(`@ai-sdk/open-responses`, the minimal dialect for subset Responses servers —
see [Adapter Family](./adapter-family.md)) is deliberately NOT named
`openai-responses`, or this suffix probe would silently reroute every
`adapterFamily: 'openai'` responses endpoint onto it. `azure-anthropic` is not reached through the suffix
rule — it is selected inside `buildAzureConfig` when the model is a Claude
model (see below). `resolveProviderVariant(baseId, endpointType)` is
idempotent when the base id is already a variant.

## Provider config

`providerToAiSdkConfig(provider, model, { apiKeyOverride?, resolvedEndpoint? })`
(`src/main/ai/provider/config.ts`) returns
`{ providerId: AppProviderId, providerSettings: AppProviderSettingsMap[id] }`.
The standard request path passes its already-resolved endpoint into this
function, which then calls `resolveAiSdkProviderId` and dispatches through an
ordered `{ match, build }` table to build the provider-specific settings
object (apiKey, baseURL, organization, headers, ...). Direct callers may omit
the option and let the function resolve the endpoint itself.

`resolveSdkConfig` (`src/main/ai/provider/sdkConfig.ts`) wraps it with the wire
model id and the `providerOptions` namespace. It is the modality-agnostic
transport core: `AiService`'s embedding, rerank and image verbs call it
directly, and the chat pipeline (`buildAgentParams`) layers tools, prompt and
context on top of it. Compression-model resolution also uses this core,
including wire model normalization, before binding its owning conversation
to the summary model.

**Builders never read request context.** A config is a function of the
provider, the model, the endpoint and the credential. When a provider's
protocol needs something per request, the builder *declares* it and the chat
pipeline fulfils it — OpenCode Go/Zen requires `x-opencode-session`, so
`buildOpenCodeGoConfig` sets `ProviderConfig.conversationHeader` and
`buildAgentOptions` fills it from `request.conversation.id`. Only chat
requests (`AiChatRequest`) carry a conversation; embedding, rerank and image
requests have no such field, so nothing below the caller has to derive or
default one.

The builder table (`config.ts`, first match wins):

| Match | Builder | Notes |
|---|---|---|
| `id === copilot` | `buildCopilotConfig` | async — fetches a Copilot token |
| `id === 'cherryai'` | `buildCherryAIConfig` | HMAC-signs requests; refuses them before sending unless signed in to Cherry AI |
| `isOllamaProvider` | `buildOllamaConfig` | |
| `isAzureOpenAIProvider` | `buildAzureConfig` | returns `azure` / `azure-responses` / `azure-anthropic` (Claude on Azure) |
| `id === 'bedrock'` | `buildBedrockConfig` | |
| `id === 'google-vertex'` | `buildVertexConfig` | returns `google-vertex` or `google-vertex-anthropic` for Claude; leaves `baseURL` undefined when no host is configured so the SDK derives the aiplatform host |
| `provider.id === 'cherryin'` | `buildCherryinConfig` | matches the **provider id**, not the resolved variant — the default chat endpoint resolves to `cherryin-chat`, so an `id === 'cherryin'` check never fires; async — resolves relay base URLs |
| `id === 'newapi'` | `buildNewApiConfig` | |
| `id === 'aihubmix'` | `buildAiHubMixConfig` | passes the Chat, Responses, Anthropic, and Gemini URLs independently |
| `id === 'dmxapi'` | `buildDmxapiConfig` | passes the Chat, Anthropic, and Gemini URLs independently |
| _(no match)_ | `buildGenericProviderConfig` / `buildOpenAICompatibleConfig` | generic fallback |

Several builders are `async` (Copilot token, CherryIN relay URLs), which is
why `providerToAiSdkConfig` returns a promise.

## Custom provider exact paths

`EndpointConfig.pathMode` is a user-owned connection override. Missing or `host` keeps normal URL formatting. `complete` bypasses API-version formatting and endpoint-suffix inference, then `createExactPathFetch` pins the request to the configured URL over the builder's existing fetch. The adapter still owns the request/response protocol. A bare origin therefore targets `/`; trailing slashes, encoded paths and query parameters are preserved, subject to standard URL parsing and removal of a legacy trailing `#` marker.

Custom-provider creation stores the mode independently for each entered endpoint. Request configuration reloads and saves the text and image modes without replacing sibling configuration or adapter metadata. Both surfaces preview the selected mode; primary connection settings also support Anthropic's independent exact-path preview.

The fetch wrapper annotates thrown transport failures with a redacted effective URL and supplies that route to the HTTP trace slot. `exactRequestUrl` also travels with the resolved config, outside adapter settings. Chat's `exact-path-diagnostics` feature installs model middleware that corrects SDK-created HTTP/parser errors, stream error chunks and rejected stream reads after adapter execution. Compression models use the same middleware. Direct image, embedding and rerank calls use the shared error boundary after SDK execution. Error identity, status and retry flags are preserved; frozen third-party error objects are left unchanged rather than replacing the failure.

Local tests cover successful and failing OpenAI-compatible, Anthropic, Google and Open Responses generate/stream round trips through production config, feature registration and SDK model execution, plus parsing errors, late stream errors, cancellation, service boundaries and credential redaction. These substitute Node fetch at the Electron boundary. A transport-only Electron harness can check the real `customFetch` boundary, but does not establish full application startup, provider persistence or settings UI acceptance. Packaged-app acceptance remains separate; the implementation remains draft under open spec PR #23804.

## Custom providers

`src/main/ai/provider/custom/`:

- **aihubmix** — multi-vendor relay. Its model-id router selects the
  Anthropic, Gemini, OpenAI Responses, or OpenAI-compatible model and consumes
  the matching endpoint URL from provider settings.
- **dmxapi** — multi-vendor relay. Its model-id router selects Anthropic,
  Gemini, OpenAI, or compatible models and consumes the matching endpoint URL.
- **newapi** — same shape, different relay.

All three register through `ProviderExtension.create(...)` with their own
`AppProviderSettings` shape.

## Provider extensions

`src/main/ai/provider/extensions.ts` registers every
`@ai-sdk/*` package Cherry uses with `ProviderExtension.create`. Each
extension declares:

- `name` (the `AppProviderId` for the base)
- `aliases` (alternate ids that normalize to `name`)
- `variants` (suffix entries — see above)
- `create` (the SDK's factory)
- `toolFactories` (per-capability factory functions for `webSearch` /
  `urlContext` etc.)
- `supportsImageGeneration` (boolean flag)

## Where to read more

- Code: `src/main/ai/provider/`
- Tests: `provider/__tests__/endpoint.test.ts` (54 cases)
- Legacy provider imports: [intermediate upgrade release](../data/v2-migration-guide.md)
- Catalog (new installs): `packages/provider-registry/data/providers.json`
- Design: [Adapter Family](./adapter-family.md)
