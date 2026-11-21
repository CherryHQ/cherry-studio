# Agent Note: Stateless Gemini Interactions and native replay

Status: proposed

English | [中文](2026-11-14-gemini-interactions-support.zh.md)

## Problem

The baseline is `f62d636d5b1e75378ae6ba848456cebd2e73a6b8`, containing PR #24517 (Google SDK `3.0.146`, Hydrogen and Pi XHIGH) and PR #24476 (Carbon and saved user reasoning defaults). These are prerequisites already present, not implementation work proposed here. Carbon's missing individual search/URL selectors are a separate mechanical restoration of the existing contract, with an explicit N/A classification; this Spec does not authorize or claim that fix. Carbon's documented built-in/function combination belongs to the new Interactions endpoint contract, not a model-wide enablement.

Cherry still lacks an explicit Interactions route and its request dialect. The Google SDK already supports signature-only thoughts and late signatures at their source; those are preservation requirements, not isolated parser defects. Its current mixed-summary projection and built-in call/result conversion cannot represent every native step. UI folding, ordinary editing and the native Agent gateway introduce further boundaries where signatures, ordered content, files or step identity can disappear.

This is a new protocol decision alongside the existing [gateway execution owner](../../implemented/architecture/2026-11-09-gateway-sdk-forwarding.md), [Pi replay identity decision](../../implemented/bug-fix/2026-10-29-pi-google-replay-identity.md), and [usage ownership decision](../../implemented/bug-fix/2026-10-30-agent-usage-ownership.md). It extends their bounded supported semantics without replacing their execution, identity or billing ownership. No active Interactions note exists at this baseline. The earlier broad local Spec is historical and supplies neither scope nor approval.

## Proposal

### Scope and existing owners

Add opt-in Interactions for ordinary chat, Pi and Pi Durable. Keep all old-route behavior, including generateContent, Vertex, relays, custom hosts and headers, default endpoints, image/embedding paths and CLI exports. No model registration, SDK upgrade, new user-default control, migration, global metadata codec/cache, parallel HTTP/SSE client or OpenAI fallback belongs here. Managed agents, background execution, explicit caching and an external `/interactions` server remain excluded.

Paths below are baseline owners; proposed fields and future tests are not claims of existing implementation.

| Boundary | Existing owner and proposed responsibility |
| --- | --- |
| Endpoint and SDK construction | `packages/provider-registry/src/schemas/enums.ts`, `src/schemas/provider-models.ts`, `src/registry-utils.ts`, `src/providers/gemini.ts` within that package; `src/main/ai/provider/endpoint.ts`, `config.ts`; `packages/aiCore/src/core/providers/core/initialization.ts`: additive endpoint/variant, validation and `provider.interactions(modelId)` |
| Parameters and reservation | Registry `src/reasoningProfiles.ts`, `src/schemas/reasoningWire.ts`; `packages/aiCore/src/core/options/types.ts`; `src/main/ai/utils/reasoningSerializers.ts`, `modelParameters.ts`; `src/main/ai/runtime/aiSdk/params/buildAgentParams.ts`, `customParamsFetch.ts`; `src/main/ai/contextBuild/resolveOutputReservation.ts`: dialect, provenance and final request admission |
| Endpoint tool coexistence | `packages/provider-registry/src/creators/types.ts`, `src/creators/google.ts`, `src/patterns/serverToolConstraints.ts`, `scripts/generate-catalog.ts` within that package; `src/shared/utils/provider.ts`: extend the existing upstream generated capability query with endpoint context before both predictive and final route decisions |
| SDK replay and message shaping | `patches/@ai-sdk__google@3.0.146.patch`, SDK `src/interactions/parse-google-interactions-outputs.ts`, `build-google-interactions-stream-transform.ts`, `convert-to-google-interactions-input.ts`; `src/main/ai/messages/messageRules.ts`: complete step ownership before lossy shaping |
| Editing and storage | `src/renderer/components/composer/variants/ChatComposer.tsx`, sibling `chat/messageEditingDraft.ts`; `src/renderer/components/chat/messages/blocks/reasoningEditing.ts`; `src/shared/data/types/uiParts.ts`; `src/renderer/pages/home/hooks/useChatWriteActions.ts`; `src/main/data/services/MessageService.ts`: pre-erasure invalidation and existing parts JSON persistence |
| Native gateway and projections | `src/shared/ai/piModelCompatibility.ts`; `src/main/ai/runtime/pi/gatewayModelBinding.ts`, `PiMessageMetadata.ts`; `src/main/features/apiGateway/proxyStream.ts`, `adapters/interfaces.ts`, `adapters/converters/GeminiMessageConverter.ts`, `adapters/stream/AiSdkToGeminiSse.ts`; existing Pi patch; `packages/agent-runtime-pi/src/runtimeProjection.ts`, `packages/agent-runtime-pi-durable/src/content.ts`: protocol context and native carrier restoration |
| Catalog admission and publication | `packages/provider-registry/src/catalog.ts`, `src/registry-loader.ts`, `scripts/generate-catalog.ts`; `src/main/data/services/ProviderRegistryService.ts`, `utils/registryDataPaths.ts`; `src/main/services/ProviderRegistryUpdaterService.ts`; `scripts/publishRegistryCatalog.js`: additive local merge, stream isolation and atomic legacy projection |
| Configuration surface | Existing `ProviderEditorDrawer`, `ProviderCustomHeaderDrawer`, `ModelPurpose` and `EditModelDrawer` owners under `src/renderer/pages/settings/ProviderSettings/`: protocol selection, existing saved-default control and translated labels |

### Explicit route and request contract

Introduce endpoint `google-interactions` and SDK variant `google-interactions`, with `adapterFamily: 'google'`, the existing Google factory/tool factories and `provider.interactions(modelId)`. Use the existing URL formatter for `v1beta`, model prefixes including `models/`, custom bases and `#` path rules. A preset read-time additive endpoint merge preserves stored user URL/dialect values and the old default; no database migration is needed. Selecting the new endpoint is the only way to change protocols.

Extend the closed reasoning profile/target vocabulary and typed options for `providerOptions.google.thinkingLevel` and `thinkingSummaries`. The SDK serializes these as `generation_config.thinking_level` and `generation_config.thinking_summaries`. Summaries accept only `auto | none`, using `auto` when reasoning is active; never leak `concise`, `detailed`, `thinkingConfig` or legacy budget fields. Carbon retains `low/medium/high`, Hydrogen retains `low/medium/high/xhigh`; neither acquires a reasoning-off promise. Cross-model Carbon `xhigh` follows the existing projection to `high`.

Resolve explicit composer effort first, then saved `userDefaultReasoningEffort` for missing/default selection, then omit the endpoint option. Catalog defaults are capability/display data, never saved user intent. Preserve the strict patch DTO, null-clear API, runtime provenance and create/edit/reload behavior from PR #24476. Preserve provider-specific imported defaults, including OpenRouter Hydrogen `medium`. Reuse the current control; a new clear-to-inherit UI is outside scope.

Ordinary requests send `store: false` and full client-owned history. Reject `store: true`, background execution and previous-interaction continuation (`previousInteractionId` / `previous_interaction_id`); never switch protocols to accept them. After assistant settings, custom parameters, raw body patches and call overrides have merged, enforce the shared context reservation and the ordinary Interactions thinking-plus-output ceiling of `65,536`. It is one combined reservation, not two independently additive allowances. `65,536` is accepted and `65,537` is rejected before HTTP dispatch. Keep model-wide `contextWindow` and `maxOutputTokens` at `1,048,576`; existing generateContent large-output requests, including `131,072` and Argon continuation, retain their behavior.

At those existing parameter/fetch owners, omit unsupported `safetySettings`, `cachedContent`/`cached_content` and Gemini 4 sampling keys, including known raw `generation_config`/`generationConfig` containers. Do not recursively erase application metadata or alter the existing Gemini 4 sampling early return. Do not attach the OpenAI-compatible signature-skipping middleware to the native route.

### Endpoint-scoped Carbon tool coexistence

The first-party Carbon model/search pages confirm individual search and URL support. The [tool-combination](https://aistudio.google.com/docs/tool-combination) and [function-calling](https://aistudio.google.com/docs/function-calling) examples document built-in plus function combinations in Interactions. Cloud generateContent restrictions do not establish the same prohibition for Developer API generateContent. Do not claim that legacy Carbon mixing is either newly enabled or conclusively prohibited across APIs.

The existing `ServerToolConfig.endpointTypes` and generated model eligibility already scope individual server-tool availability by endpoint; reuse them for the new bundled endpoint. They cannot express coexistence: `Creator.serverToolFunctionMixing` and `supportsServerToolFunctionMixing(rawModelId)` are model-wide. The minimal upstream improvement is to extend that existing creator/generator/query owner with an additive, generation-only `Creator.serverToolFunctionMixingByEndpoint?: Partial<Record<EndpointType, string[]>>`. Declare Carbon only under `google-interactions`, compile it into endpoint-indexed exact normalized IDs alongside the existing generated constraints, and leave the old global declaration/set unchanged. This is bundled capability data, not a new model/override remote field or publication version.

Extend the existing registry query to `supportsServerToolFunctionMixing(rawModelId: string, endpointType?: EndpointType): boolean`: accept the prior global set or the explicit endpoint's generated set; an omitted/unknown endpoint gains no new support. Preserve current size-aware model normalization. In `src/shared/utils/provider.ts`, `resolveWebToolRoutes` uses its existing `options.endpointType` through `resolveServerToolEndpoint`; extend `finalizeWebToolRoutes(routes, model, provider, hasFunctionTools, endpointType?)` with the same context. `buildAgentParams` passes its already resolved `resolvedEndpoint.endpointType` to finalization. Both renderer prediction and actual request routing therefore consult the same upstream capability result; do not add Carbon exceptions or a new fallback in downstream callers.

Tests must prove Carbon's individual tools remain eligible, its built-in/function combination survives both routing stages only for explicit Interactions, and omitted endpoint, generateContent, Vertex, relay and all prior global flags retain their exact old results. Real SDK loopback must contain both native tools and original-ID functions on Interactions; legacy request fixtures must remain unchanged. This source-interface improvement is proposed for human approval with endpoint support, not implemented by the separate mechanical task.

### Authoritative native step replay

Extend the existing SDK parser, stream assembler and input converter. Each completed native step owns its entire JSON object, including unknown fields, ordered mixed summary/content, signatures, IDs, call associations and error fields. The following is the proposed metadata shape; `NativeStep` means that full JSON object.

```ts
providerMetadata.google.interactionsReplay = {
  version: 1, turnKey: string, index: number, step: NativeStep
}
providerMetadata.google.interactionsReplayRef = { turnKey: string, index: number }
```

Allocate `turnKey` once per invocation independently of server IDs and persist it. One thought owns its reasoning record; a model output owns its first text or, when textless, first file. Built-in calls and results own separate records in `callProviderMetadata` and `resultProviderMetadata`, even when the UI folds them together. Other display parts reference the owner; projectionless steps use protected empty-text carriers.

Streaming assembly retains each native index's start payload, ordered deltas, mixed-summary objects and late metadata. Finalize at `step.stop` through end metadata, final tool events or buffered files. A late signature updates the same owner, never creates another step. Replay complete records in invocation/index order, never tool completion or display order. Incomplete records cannot masquerade as successful replay.

Before shaping, `messageRules` preserves owner/reference groups. Input conversion accepts authority only in assistant slots matching the raw type: reasoning/thought, text-or-file/model output, matching-ID tool-call/native call, or matching-call-ID assistant tool-result/native built-in result with provider-executed context. Emit each raw step once and consume only its assistant display references. Duplicate eligible owners and unexplained missing assistant owners are invalid.

AI `6.0.185` copies call metadata onto local role-tool results. That inherited metadata is association-only, excluded from owner, duplicate-owner and missing-reference checks. Do not consume the genuine local result or reuse its call signature. Serialize its current output exactly once as fresh `user_input.content[].function_result`, retaining the original `toolCallId`. Provider-executed built-ins retain their separate native result record. Real function IDs remain intact for same-name parallel calls.

### Editing, reload and branch preservation

Capture original replay groups in `ChatComposer` before either reasoning replacement or `replaceEditedMessageParts` erases metadata. Extend the existing `messageEditingDraft` owner, including no-span and early-return cases: exclude metadata-only carriers from editable text, retain unchanged hidden groups at their logical slots, and compare text, attachments and anchors before rebuilding. Dedicated reasoning edits use the same policy.

Changed or removed groups lose their old raw owner. Extend both `CherryTextMeta` and `CherryTextMetaSchema` with `interactionsReplayEdits`; store the following entries on one protected empty TextUIPart at `providerMetadata.cherry.interactionsReplayEdits`.

```ts
{ turnKey: string, index: number, state: 'invalid-signed' | 'regenerate' }
```

Any affected signed step leaves `invalid-signed`, even when its last reasoning, file or built-in carrier is deleted. `messageRules` checks this before normalization/network access and visibly requires regeneration from a valid pre-edit branch; never fabricate signatures or silently restore old content. Unsigned changed groups leave `regenerate` slots with current projections; valid deletions have no projection. A merged text span takes its first affected slot and leaves the others empty. Unchanged hidden slots retain their original records.

The existing edit write PATCH includes all edited parts; `MessageDataSchema` accepts parts, and `MessageService` stores them in JSON `message.data`. Preserve these markers across reload, subsequent edits and branch copies without a new column. Strip markers only from outbound conversion, where unsigned slots emit current content at their indexed positions. Successful regeneration replaces the group with a new `turnKey`. Legacy `<think>` editing behavior remains unchanged.

### Pi and Durable native transport

Explicitly bind the new endpoint to the existing native Gemini internal envelope and pass the resolved protocol through `proxyStream` to converters and SSE adapters. Use native `Part.partMetadata.cherryInteractions` for the replay record/reference or `{edit: entries}`. Extend the narrow existing Pi patch with typed `googleInteractions` content fields, parser retention and replay handling. Read these fields in `google-shared.convertMessages` before `transformMessages`, empty-content, signature/model identity or ID normalization can discard them. Preserve XHIGH, custom fetch and existing identity rules.

Built-in native calls/results and projectionless steps travel as non-executable empty text carriers, never Pi executable `toolCall` entries. Genuine local function calls remain executable with original `functionCall.id`/`functionResponse.id`, including Cherry-prefixed model IDs.

For a file-only model output, `AiSdkToGeminiSse` transfers its sole authority into one `{text: '', partMetadata: {cherryInteractions: record}}` carrier in both streaming and unary accumulation. The file is neither a second owner nor a Pi file Part. References use equivalent text carriers. Pi stores the full raw file payload in TextContent. `GeminiMessageConverter` consumes transport text on ingress, reconstructs files and restores exactly one first-file owner plus sibling references. Pi `runtimeProjection`, Durable `content` and `PiMessageMetadata` restore the same display grouping.

Native start/end/result chunks preserve boundaries; late metadata updates the indexed owner. Native branch writers transfer protected edit sentinels into non-executable TextContent with `googleInteractions: {edit: entries}`, returning them as `partMetadata.cherryInteractions: {edit: entries}`. Ingress restores CherryTextMeta before `messageRules`. Pi JSON messages and Durable `model: [message]` preserve records and sentinels across persistence, restart and branch operations; product display messages never replace native history.

Reject incompatible other inbound/output protocol combinations with the new endpoint explicitly. Do not route them through a lossy Anthropic/OpenAI conversion, fabricate a signature, or add a global codec/cache. All existing combinations on old endpoints retain their behavior. Gateway tools have no executor; Cherry keeps upstream credentials and the existing single SDK execution and billing owners.

### Cancellation, errors and preservation

Foreground cancellation must abort the upstream request and archive the chat/Pi/Durable turn as cancelled. Non-2xx and mid-stream errors remain visible errors, never successful completions. Persist actual incurred observable usage once through the existing gateway/provider ledger with request-time attribution; late native correlation must not add a charge. Do not fabricate zero usage or duplicate billing on cancellation/error.

Preserve the eight existing Google patch additions: model-path handling in public/internal CJS and ESM (four), image predict path in public CJS/ESM (two), Gemini/nano-banana recognition in public CJS/ESM (two). Preserve Pi XHIGH/custom fetch, SDK resolution and existing generateContent continuation/usage behavior.

### Bundled delivery and future publication

The bundled additive stage can deliver endpoint/profile support offline while remote `models.json` and `provider-models.json` keep their existing v4 semantics and floor `2.1.11`. Providers remain bundled; `ProviderRegistryService` unions preset endpoint keys at read time while preserving user values. Old readers can filter unknown endpoint-list members while retaining a model, but unknown endpoint-config/reasoning-contract record keys, format discriminators or wire targets can reject their enclosing provider/override. Schema parsing alone does not establish runtime support.

Publishing new remote wire semantics requires stream v5 and a release-owner-assigned first compatible Desktop release `R` containing the complete interpreter/routing contract. Generate only the new v5 validator through `compat:baseline`; frozen v1-v4 validators and floors remain unchanged. The baseline's application `2.2.2` is not a proven compatible floor. Do not invent a production version or bump the application merely for this Spec. Release `R` and publication timing are external decisions; no publication is authorized.

The local publisher correction belongs to implementation tasks 4/8 and is not blocked on assigning `R`. Extend `scripts/publishRegistryCatalog.js` to project each legacy candidate before frozen validation: remove new endpoint-list members, endpoint-config keys and reasoning-contract keys, including their nested new profiles/targets. Retain recognized endpoint order/defaults and existing generateContent operations, support and defaults. Never achieve acceptance by deleting an existing model or override, or by using parsed rows after loose validation already filtered them.

Compare each existing stream's previous published snapshot with its projected candidate. Preserve model-ID multisets, API IDs and override identities `(providerId, modelId, sorted modelVariants)`, with unchanged previously usable legacy request semantics. Unsupported targets inside retained legacy contracts block admission unless projection demonstrably restores the exact prior contract. Missing comparison evidence or unproven preservation rejects the entire publication invocation atomically.

Stage all streams' files/manifests in memory before writing; failure writes no destination bytes and returns failure with no success list. Reuse existing serialization, version stamping and manifest hashes. Historical-reader fixtures must inspect parsed identities/contracts for v1-v4, not merely void frozen-validator success: additive keys preserve rows, nested new targets never leak, missing old rows and incompatible retained targets fail with all destinations unchanged, v4 retains floor `2.1.11`, and v5 bytes remain intact. Manifest/updater/cache fixtures prove v4 rejects v5, downgrade ignores v5 cache and eligible v5 activates only complete snapshots.

Catalog generation stays with creator/provider sources and the existing generator; no hand-edited generated JSON or parallel registry. Task 8 supplies the registry feature Changeset through normal package release ownership, without duplicating upstream model Changesets.

## Alternatives considered

- Change the existing Google default route: rejected because saved connections, Vertex and relays must retain their protocol.
- Add only signature aliases or reconstruct steps from visible text: rejected because mixed summaries, native built-ins, files and ordering cannot be recovered from projections.
- Reimplement HTTP transport or use an OpenAI fallback: rejected because it duplicates credentials, stream, cancellation and usage ownership and loses native semantics.
- Restore old signed text after editing or drop empty carriers: rejected because it discards user intent or hides an invalid signature chain.
- Lower the shared model output cap to the foreground limit, or enable background/store continuation: rejected because model-wide long output and ordinary Interactions are different contracts; background requires a separate decision.
- Publish new keys into v4 and trust loose validation: rejected because unknown record keys/targets can drop previously usable overrides. A v5 stream alone does not repair legacy publication; pre-validation projection and atomic preservation evidence are required.

## Acceptance criteria

- AC1 — Carbon's three efforts/default medium and Hydrogen's four efforts/default high, individual official search/URL declarations, existing global mixing flags, provider-specific defaults and model-wide `1,048,576` context/output remain correct through baseline reuse and the separate mechanical selector fix; no duplicate model/SDK/default-control work is introduced. (verification: unit; owner: tasks 3/5, provider-registry and Google wire fixtures)
- AC2 — Explicit Interactions selection alone calls the SDK Interactions route with the additive Google variant, correct URL/model formatting, `thinkingLevel`, `thinkingSummaries: auto | none` and `store: false`; endpoint-aware upstream resolution permits documented Carbon built-in/function combinations without changing legacy generateContent/Vertex/global flags; legacy dialect, unsupported sampling/cache and forbidden server-state overrides cannot reach HTTP. (verification: unit and Electron; owner: tasks 4/5/7, real SDK loopback and saved configuration)
- AC3 — Two-turn chat, Pi and Durable replay preserves ordered full native steps, mixed summaries, built-in calls/results, distinct same-name function IDs, local results, signature-only and late metadata exactly once across actual native persistence/restart/reload/branch; file-only owners and edit sentinels survive transport, signed invalid edits visibly require regeneration and valid unsigned edits send current content. (verification: unit and Electron; owner: tasks 2/5/6, SDK/gateway/native storage fixtures)
- AC4 — Explicit composer effort overrides saved user default; missing/default inherits saved intent and null-clear restores omission, without treating catalog defaults as user intent; OpenRouter medium, custom host/header, old endpoint/default, Vertex/relay and CLI behavior survive save/reload. (verification: unit and Electron; owner: tasks 4/5/7, serializer/service/configuration fixtures)
- AC5 — After all overrides, ordinary Interactions accepts combined thinking/output `65,536` and rejects `65,537` before dispatch while preserving the shared window and old large-output/continuation routes; cancellation aborts upstream and archives cancelled, errors never archive success, and actual incurred usage is attributed once without fake zero or duplicate charges. (verification: unit and Electron; owner: tasks 2/5/6, real SDK loopback, archive and usage fixtures)
- AC6 — The current Spec head receives explicit human Approval before protocol implementation; paired docs and final AC evidence agree; bundled/local work and v5 publication are distinct, legacy projection preserves historical-reader identities/contracts atomically, frozen streams stay intact and publication waits for release-owner `R` and authorization. (verification: docs gate and unit; owner: tasks 1/4/8 and final compliance review)

### Future verification ownership

These checks describe implementation acceptance; they have not run as part of authoring this proposed Spec. Real SDK-to-loopback requests must inspect the final body and two-turn raw replay, not mock call counts or paid-provider promises. New Interactions fixtures will live beside existing Google provider tests.

| Coverage | Existing tests to extend or run with explicit file filters |
| --- | --- |
| Models and old SDK behavior | `packages/provider-registry/src/__tests__/gemini4.test.ts`, `google-catalog.test.ts`, `catalog-source-sync.test.ts`; `src/main/ai/provider/__tests__/gemini4.test.ts`, `googleImageModel.test.ts` |
| Endpoint tool coexistence | `src/shared/utils/__tests__/provider.serverTools.test.ts`; existing registry server-tool constraint tests and source-sync tests; `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`; real Interactions and unchanged generateContent/Vertex wire fixtures |
| Routing and final parameters | `src/main/ai/provider/__tests__/endpoint.test.ts`, `config.test.ts`; `src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`; `src/main/ai/utils/__tests__/reasoningSerializers.test.ts`, `modelParameters.test.ts`; `packages/aiCore/src/core/providers/__tests__/types.test.ts`, `src/core/runtime/__tests__/executor-resolveModel.test.ts` within that package |
| Edit and persistence | `src/renderer/components/composer/variants/chat/__tests__/messageEditingDraft.test.ts`; `src/renderer/components/composer/__tests__/composerInputAdapter.test.ts`; `src/main/data/services/__tests__/ProviderRegistryService.test.ts`; actual message reload/branch and native session/restart fixtures using production migrations through `setupTestDatabase()` |
| Agent transport | `src/main/ai/runtime/pi/gatewayModelBinding.test.ts`, `gatewayIntegration.test.ts`, `piGoogleReasoning.test.ts`; `src/main/features/apiGateway/adapters/__tests__/GeminiMessageConverter.test.ts`, `AiSdkToGeminiSse.test.ts`, `AnthropicMessageConverter.test.ts`, `AiSdkToAnthropicSse.test.ts`; actual Pi and Durable loopback execution |
| Catalog safety | `packages/provider-registry/src/__tests__/forward-compatibility.test.ts`, `provider-reasoning-contracts.test.ts`; `scripts/__tests__/publishRegistryCatalog.test.ts`, with historical-reader and manifest/updater/cache coverage |
| Configuration and docs | Existing provider editor/custom-provider/model-purpose/default-effort renderer tests; tracked Electron loopback save/reopen at desktop/mobile widths; `pnpm docs:affected --base f62d636d5b1e75378ae6ba848456cebd2e73a6b8`, paired docs, scoped format and docs gates |

## Risks

Native records increase persisted message size; projections must not duplicate authority or execute built-ins. Stream interleaving, final metadata and file-only output require tests through actual SDK/native stores, not metadata-name assertions. Editing must mark invalidation before erasure and preserve it through every normalization boundary.

Protocol admission must reject unsupported combinations visibly without changing old routes. Cancellation can follow real incurred usage; accurate ownership does not promise provider invoice reconciliation. Catalog publication can otherwise silently remove usable rows even when validators succeed. Runtime implementation and historical-reader evidence are still required; this proposed note is not self-approval, a live-provider acceptance claim or publication authorization.
