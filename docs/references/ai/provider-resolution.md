---
description: Endpoint resolution chain from provider.endpointConfigs and adapterFamily to the AI SDK provider id and variants
sources:
  - src/main/ai/provider/endpoint.ts
  - src/main/ai/provider/config.ts
  - src/main/ai/provider/endpointConnection.ts
  - src/main/ai/provider/speech.ts
  - src/main/ai/provider/custom/geminiSpeechModel.ts
  - src/main/ai/voice/speechModels.ts
  - packages/provider-registry/src/registry-utils.ts
  - packages/aiCore/src/core/providers/core/initialization.ts
---

# Provider Resolution

## The problem this solves

A request needs to know which `@ai-sdk/*` package to import, with which
settings, hitting which URL. Three pieces of state determine that:

| Field | Lives on | Example |
|---|---|---|
| `provider.id` | `Provider` row | `minimax`, `silicon`, `my-relay` |
| `endpointType` | Applicable declared model endpoint, or `provider.defaultChatEndpoint` | `openai-chat-completions`, `anthropic-messages` |
| `adapterFamily` | `provider.endpointConfigs[endpointType].adapterFamily` | `openai-compatible`, `anthropic`, `azure-responses` |

`adapterFamily` is the actual SDK selector. `provider.id` is the user-facing
identity. `endpointType` is the protocol family. The mapping is written
once at provider-creation time; runtime resolution is read-only.

See [Adapter Family](./adapter-family.md) for the full design.

## Resolver

`src/main/ai/provider/endpoint.ts` exposes the resolution helpers:

```ts
resolveEffectiveEndpoint(provider, model): { endpointType, baseUrl, languageModelAdapter? }
resolveRequestEndpoint(provider, model, kind): { endpointType, baseUrl, languageModelAdapter? }
resolveProviderVariant(baseProviderId, endpointType): AppProviderId
resolveAiSdkProviderId(provider, endpointType): AppProviderId
resolveProviderOptionsKey(aiSdkProviderId, context): string
```

`resolveAiSdkProviderId` is the runtime hot-path entry. It reads
`provider.endpointConfigs[endpointType].adapterFamily`, applies the
variant suffix if the endpoint type has one, falls back to
`openai-compatible` when no family is set.

Main and Pi share `selectChatEndpoint`: usable preference, explicit model endpoint,
deployment model default, provider default, then the first configured connection.
Explicit model endpoints are never replaced by a model-name rule.

Multi-backend extensions register `resolveLanguageModelAdapter` beside their provider
factory. It returns one executable `LanguageModelAdapter`: the model constructor and
the `providerOptions` namespace that constructor consumes. `resolveEffectiveEndpoint`
carries that object into the config builder and SDK factory; parameter encoding reads
its namespace. Public routing contains no AiHubMix/DMXAPI dispatch table. Within an
already selected Chat endpoint, an extension can choose native OpenAI or compatible
Chat serialization; it cannot change the selected protocol or connection.

Deployment model defaults contain endpoint metadata only. `ProviderRegistryService`
passes a model-specific default separately to `suggestModelEndpoints`; it never
changes the meaning of the provider's `defaultChatEndpoint`. Incomplete descriptors
can still use this same pure default lookup, shared by Main and Pi.

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

Non-chat entry points select their request endpoint before building SDK settings.
`resolveRequestEndpoint` accepts image, image-edit, embedding, speech, or rerank
requirements; it does not store an operation on the model. Dedicated task endpoints
and applicable Google endpoints retain their declared order, ahead of general
compatible adapter fallbacks. An image-edit request uses the declared Edit endpoint
when present, so its address override is respected. Chat ordering and endpoint-specific
server tools continue to use the existing chat resolver.

The built-in local embedding adapter needs neither a network endpoint nor a URL.
Speech discovery uses `findRequestEndpoint`, the non-throwing form of the same
selector: unsupported model metadata omits that entry without failing the model list.

## Connection inheritance

`resolveEndpointBaseUrl` in `src/main/ai/provider/endpointConnection.ts` resolves the
address independently of the target adapter and wire protocol:

1. Use the target endpoint's own non-empty address.
2. Use the provider's default chat endpoint when its connection is compatible.
3. Search compatible endpoints in the registry's fixed order (OpenAI Chat before
   Responses, followed by task endpoints).
4. Return an empty string when no compatible connection exists.

The pure source decision lives in the registry's `resolveEndpointConnection`.
Settings use the same decision to show the selected endpoint, configured address
(with credential parameters redacted), and inheritance source. Main owns complete-URL
normalization and SDK path construction.
Vertex and Bedrock SDKs can derive hosts from project/location or region; settings
do not report a missing connection when those adapters omit an explicit URL.

The registry exhaustively classifies every `EndpointType`. OpenAI-style task
endpoints, including rerank, share the OpenAI-compatible connection root;
Google, Anthropic and Ollama have separate roots. New API additionally allows
its explicitly `newapi`-tagged endpoints to share one gateway root across
protocols. This does not allow an ordinary custom Gemini connection to supply
an OpenAI Images request. A caller's preferred endpoint is usable when the
model declares it and this same resolver finds a connection.

When neither the model nor provider selects an endpoint, the runtime chooses
the first configured address in registry order. An explicit model endpoint
never falls back to another protocol. Model discovery retains the older
`getBaseUrl` behavior; request builders use the strict resolver.

An inherited complete URL such as `.../chat/completions#` contributes only its
root; the target image or speech adapter supplies its own path. Explicit target
URLs keep their endpoint suffix. Parse that suffix before URL formatting strips
`#`, so the SDK cannot append the endpoint twice.

Key-backed request builders reject a missing connection before selecting an API
key or sending a request. SDK-derived Vertex/Bedrock addresses, local embedding,
managed transports and OAuth defaults retain their own builder semantics.

Runtime inheritance never mutates `endpointConfigs` or writes a resolved URL
back to storage. Presets must not copy a primary connection URL into same-family
task endpoints; omit the task URL while retaining adapter metadata. Explicit
user overrides remain authoritative, and clearing one restores inheritance.

Model forms edit `endpointTypes`, `capabilities`, `inputModalities` and
`outputModalities` directly. Capabilities and modalities are independent
multi-selections: enabling image generation does not replace Gemini
`generateContent` with OpenAI Images or remove other model capabilities.
Endpoint edits retain selection order and endpoints absent from the standard
option list. List type filters remain derived views, not editable model fields.

Editing submits only the changed fields, so renaming a catalog-backed model does
not persist its inherited capabilities or modalities as overrides. Manual and batch
creation resolve defaults on blur or submission through the same Main owner as
import. Untouched metadata is omitted from creation DTOs; explicit clearing remains
an empty array. Known task models receive endpoint suggestions compatible with the
provider's effective connections; general LLM models use the deployment's registered
per-model endpoint default when available, otherwise the provider's default Chat endpoint.
Explicit remote or user endpoint choices remain authoritative.
Native adapter task capabilities also participate in defaults and request selection:
Voyage retains its configured connection for embedding/reranking, and Bedrock
retains its SDK-hosted connection for embedding. A task protocol name alone does
not replace the native adapter or its response decoder.

Renderer batch creation respects the API's 500-model limit by sending ordered
batches and collecting their results. Earlier successful batches remain saved
if a later request fails; the failure is surfaced to the caller.


Existing rows are not rewritten automatically. The edit form previews current
defaults and can restore selected capabilities, modalities, or endpoints. Its
`resetFields` command removes the selected stored overrides atomically instead of
copying preview values. Earlier saves finish before reset, and later edits apply
afterward. Unknown models without a registry baseline cannot be reset.

## Ordinary speech synthesis

Voice settings and message read-aloud include enabled provider speech models alongside
local voices. OpenAI speech endpoints use the installed OpenAI SDK; Gemini text-only
input and audio-only output models use `generateContent` through the custom
`SpeechModelV3` adapter. Model metadata determines eligibility; a configured provider
address alone does not make every model a speech model.

This path supports API-key authentication only. IAM and OAuth providers, including
Vertex AI, are excluded from speech model lists and resolve as unsupported before
generation, even when their models use a compatible endpoint protocol.

Speech requests inherit compatible connection roots through the same endpoint
resolver. New API's registry rules recognize known speech models advertised through
its Chat endpoint and select their dedicated speech transport. The configured gateway
prefix is preserved. Explicit target addresses take precedence.

Cloud synthesis returns complete WAV audio to the existing playback session. Gemini
PCM is wrapped as WAV before playback. OpenAI applies speed during synthesis; Gemini
applies it during playback. Cloud language selection is automatic, and voice choices
come from the selected speech adapter. Cancellation discards late results. Streaming
speech and Realtime sessions are not supported by this path.

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
| `id === 'cherryai'` | `buildCherryAIConfig` | |
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
- Tests: `provider/__tests__/endpoint.test.ts`
- Migration of legacy provider rows: `src/main/data/migration/v2/migrators/mappings/ProviderModelMappings.ts`
- Catalog (new installs): `packages/provider-registry/data/providers.json`
- Design: [Adapter Family](./adapter-family.md)
