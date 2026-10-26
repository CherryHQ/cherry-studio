# Agent Note: Model defaults, explicit overrides, and endpoint routing

Status: implemented

English | [中文](2026-10-19-model-defaults-and-endpoint-routing.zh.md)

## Problem

Manual creation used to submit an initial empty capability array as a deliberate override. A known Gemini image model then disappeared from painting, although import of the same model retained its registry description. A default Chat endpoint could likewise hide a known Speech endpoint. Address inheritance alone could not repair this loss of model intent, or select a separate Images address for a model that also declared Chat.

The October 19 diagnosis at `d5122ff4e47f6b76c53988263ff60e7cb858b016` reproduced the missing painting model with `gemini-2.5-flash-image`. Enabling image generation restored eligibility, and Electron reached a local Google HTTP fixture. This established a metadata defect rather than cloud deployment acceptance.

[Spec PR #21998](https://github.com/CherryHQ/cherry-studio/pull/21998) is stacked on [prerequisite #21724](https://github.com/CherryHQ/cherry-studio/pull/21724), whose `c60f7c7ef2a35e831395847740fcf5c7a65b9007` includes connection inheritance, independent metadata controls, and ordinary cloud TTS. This implementation inherits Spec head `5f99a0b3e762352057f1850063b181d7951c84f1`. The user explicitly waived the current-head Spec approval gate for local implementation on October 20, 2026.

## Decision

System and custom providers use the same model interpretation. Extend the existing [provider resolution](../../../../docs/references/ai/provider-resolution.md) and [registry](../../../../docs/references/provider-model/provider-registry.md) owners.

| Data | Responsibility |
| --- | --- |
| Model capabilities and modalities | Supported tasks and input/output forms |
| Model `endpointTypes` | Deployment interfaces, including ordered multiple LLM endpoints |
| Provider `endpointConfigs` | Connection addresses and target adapter configuration |
| Registry | Default descriptions, provider-model differences, and connection compatibility |
| User overrides | Explicit differences for the selected deployment |

### Default descriptions

`ProviderRegistryService` resolves known descriptions using effective provider connections. Creation and reconciliation resolve context once per provider, then each model independently. Raw API model IDs survive canonical matching. Unknown models remain configurable without name-pattern guesses; lookup failures abort creation instead of silently becoming unknown models.

Manual forms resolve on blur and submission through the existing Main resolution route. Displayed defaults and explicit draft edits are separate. Identity guards discard stale results; asynchronous defaults cannot replace edited fields. Changing an ID recomputes defaults while retaining explicit draft edits. Opening another model starts its own draft. Batch submission resolves every item and applies only explicitly edited shared overrides in one create request.

Import overlays only metadata supplied by discovery. Positive discovered capabilities augment registry capabilities; an empty fetcher capability list supplies no negative claim. Explicit remote endpoints remain authoritative. Ephemeral creation metadata distinguishes remote fields from resolved display defaults, without storing touched-state or another model schema. Existing synchronized user overrides remain intact.

| Action | Stored meaning |
| --- | --- |
| Leave metadata untouched | Omit the override |
| Explicitly clear an array | Store the empty array |
| Change a field | Submit that field only; existing baseline-equal delta reduction remains |
| Restore defaults | Remove the selected stored override |

### Endpoint routing

Explicit user and provider-model/remote endpoints take precedence. Compatible known task endpoints supply suggestions; general LLM models retain the provider default. Model vendor identity does not determine a deployment protocol. Unknown Speech models can be configured through endpoint, capability, and modality controls.

At invocation, image generation/editing, embedding, rerank, and speech entry points pass their request requirements to `resolveRequestEndpoint` before SDK configuration. Dedicated task endpoints and applicable Google endpoints preserve declared order ahead of general adapter fallbacks. An image-edit request uses a declared Edit endpoint, otherwise a compatible image adapter can handle attached images. Unsupported descriptions fail before transport. Chat keeps its existing preferences, ordered endpoints, and endpoint-specific server tools.

The registry owns the pure connection-source decision: target address, compatible default LLM address, then compatible fallback in fixed registry order. Main retains URL/full-path normalization and target SDK construction. Inherited full URLs contribute a root; explicit target full URLs retain their meaning. Google, Anthropic, and ordinary OpenAI connections remain separate. The explicit New API gateway compatibility exception remains supported. Inheritance writes no addresses back to storage and transfers no source-endpoint tools.

Configuration shows the target, source endpoint, and configured address with credential parameters redacted. Missing compatible connections are explained in settings and rejected by request builders. SDK-derived Vertex/Bedrock hosts, managed transports, Google Imagen/embeddings, and existing compatible image adapters retain their established builder contracts.

The gateway follow-up removes the second protocol decision in AiHubMix/DMXAPI factories. Main and Pi share a pure endpoint selector. Registered extensions return an executable language-model adapter whose constructor and options namespace travel together; model-name checks may choose a serializer only within the selected Chat protocol. Deployment defaults remain metadata and enter model resolution separately from the provider default. A central gateway/client/namespace table was rejected because it duplicated the actual constructor decision. Standard embedding and Google image execution use the selected endpoint; bespoke image transports keep their existing lifecycle.

Native task adapter support is shared by endpoint suggestions and request selection. Voyage embedding/reranking and Bedrock embedding keep their configured adapter rather than replacing it with a generic task protocol. `nativeTaskRouting.test.ts` verifies real SDK response decoding. Batch creation sends at most 500 models per request; successful earlier batches remain persisted if a later batch fails, and the caller receives the error.

### Reset and save ordering

`resetFields` is a PATCH command restricted to capabilities, input modalities, output modalities, and endpoints. Main resolves the current baseline and clears selected columns in one synchronous write transaction. Input modality reset clears `inputModalitiesExplicit`. Contradictory set/reset requests and models without a baseline fail before writes; a failing batch rolls back all its changes. There is no database schema change.

Existing empty arrays or Chat selections remain until an explicit reset. The form previews current defaults, explains that they can evolve, and applies only selected fields. Pricing, token limits, name, enablement, and unrelated fields are preserved. The save queue places resets after earlier edits and before later edits, without merging across a reset. A failure retains the draft and retry controls. Switching models cannot redirect a queued write or apply its result to the new draft.

## Alternatives considered

- Treat every empty array as omitted: loses deliberate clearing and hides the producing form defect.
- Add feature-specific image/TTS URL workarounds: duplicates the connection owner and leaves other creation paths inconsistent.
- Add `protocolConfigs`, persisted `operation`, or provider-wide model categories: duplicates connection state and cannot represent deployment-specific model support.
- Copy canonical model endpoints or infer protocol from vendor/name: forces native transport onto compatible relays.
- Rewrite old rows or reject all multiple compatible addresses: discards user intent and changes established deterministic fallback without evidence.

## Consequences

Untouched preset descriptions can evolve with registry updates; explicit overrides keep winning. A matching catalog entry does not establish cloud authorization or actual gateway support. Configuration remains overridable, and incompatible requests report errors.

Ordinary OpenAI/Gemini/New API TTS reuses existing read-aloud and playback. Streaming playback and Realtime remain outside this decision. The voice disclosure now reflects that selecting a cloud model sends text to its provider. No credential material is needed for configuration explanations.

Implementation is covered by scoped tests, type checks, lint, documentation checks, and an isolated persistent Electron profile using local HTTP fixtures. The fixtures establish request routing, parsing, persistence, and playback state transitions. Real cloud deployment access and audio quality require separate acceptance.

## Verification

- AC1 — `ModelService.defaults.test.ts`, `modelSync.test.ts`, and `modelMetadataForms.test.tsx`: manual/default DTOs, mixed batches, and imports retain equivalent descriptions without pinning inferred fields.
- AC2 — `ModelService.defaults.test.ts` and `modelMetadataForms.test.tsx`: explicit clearing persists, selected resets restore sparse nulls and the input explicit flag, and contradictory/unknown resets make no partial writes.
- AC3 — Electron profile `PragueEndpointRouting`: entering only `models/gemini-2.5-flash-image` displays defaults, creates a painting option, and sends `/v1beta/models/gemini-2.5-flash-image:generateContent` to the configured local server; the image is persisted and displayed.
- AC4 — `speechModels.test.ts` plus Electron: known `tts-1` inherits `/v1/audio/speech`; an opaque model configured through the form appears in Voice settings, completes preview, and traverses the read-aloud player's generating/ready/playing/idle states.
- AC5 — Electron: `text-embedding-3-small` appears in the Knowledge Base selector; public `ai.embedding.embed_many` sends `/v1/embeddings` and returns the fixture vector through the real SDK.
- AC6 — `modelMetadataForms.test.tsx`, `EditModelDrawer.test.tsx`, `endpoint.test.ts`, and `provider.serverTools.test.ts`: unrelated edits preserve endpoint order and chat endpoint/tool behavior.
- AC7 — `endpoint.test.ts`, `endpointConnection.test.ts`, `config.test.ts`, `googleImageModel.test.ts`, and Electron: images use separate `/generation/v1/images/generations` and `/edit/v1/images/edits` addresses; a Google-only/OpenAI Images mismatch fails before HTTP.
- AC8 — Renderer form tests and model-handler tests: stale identities and delayed defaults do not replace explicit edits; failed lookup does not create; unknown models remain editable.
- AC9 — Shared registry connection tests, Main endpoint tests, and Electron settings: connection source/address and missing-connection explanations agree; same-family and explicit New API inheritance remain supported.
- AC10 — Real database reset tests, renderer queue/failure/model-switch tests, and Electron: existing rows change only after selected restoration; SQLite shows cleared overrides, other fields remain, and reset cannot overtake edits or update another draft.

`gatewayModelDefaults.test.ts` additionally exercises database defaults/reset and actual SDK requests: explicit Chat, Responses, and Google endpoints for a Claude model must use the selected address and request shape. Boundary tests cover thinking, compatible reasoning, authentication, and Anthropic tool restrictions. These local fixtures do not establish cloud availability.

The detailed local run record and HTTP/screenshot artifacts live under `.context/provider-diagnosis/` and `.context/cherry-electron-dev/`. Validation is local; it does not report remote CI or GitHub approval as completed.
