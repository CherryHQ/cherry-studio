# Agent Note: Model defaults, explicit overrides, and endpoint routing

Status: proposed

English | [中文](2026-10-19-model-defaults-and-endpoint-routing.zh.md)

## Problem

In the diagnosed worktree, model facts, user intent, and initial form values lose their distinction during manual creation. `AddModelFormPanel` initializes capabilities to an empty array and always submits it. `ModelService` correctly interprets that array as an explicit override of registry defaults. Consequently, a known image or embedding model can lose its capabilities, while importing the same model preserves them. The default LLM endpoint can also conceal a known model's dedicated Speech endpoint.

The October 19 diagnosis at `d5122ff4e47f6b76c53988263ff60e7cb858b016`, with the workspace's existing TTS changes, reproduced this with `gemini-2.5-flash-image`: manual creation stored empty capabilities and the painting selector had no eligible model. Enabling image generation alone restored eligibility. An Electron request then reached a local mock server through the configured Google address and returned an image. This establishes a metadata problem; it does not establish acceptance by a real cloud deployment.

Connection inheritance works for compatible endpoints in that worktree. A separate selection gap remains: a general resolver can choose the first declared endpoint even when an image request needs another declared endpoint with its own address. Sharing a connection must not imply sharing request semantics or server tools.

## Proposal

### Scope and ownership

Use one interpretation for system and custom providers. System providers supply presets; custom providers can still use known model descriptions. Extend the current [provider resolution](../../../../docs/references/ai/provider-resolution.md) and [provider registry](../../../../docs/references/provider-model/provider-registry.md) owners. This is a new decision record; no existing active note owns this proposal.

| Data | Responsibility |
| --- | --- |
| Model capabilities and modalities | Supported tasks and input/output forms |
| Model `endpointTypes` | Interfaces available for this deployment, including multiple LLM endpoints and their order |
| Provider `endpointConfigs` | Connection addresses and endpoint adapter configuration |
| Registry | Default model descriptions, provider-model differences, and connection compatibility rules |
| User overrides | Explicit differences from defaults for the selected deployment |

Reuse LLM endpoint addresses as compatible connection roots and retain per-endpoint overrides. Do not add `protocolConfigs`, persisted `operation`, or provider-wide model-category declarations. Ordinary TTS reuses read-aloud; streaming playback and Realtime remain outside this proposal.

### Baseline and implementation prerequisites

This documentation-only Spec is stacked directly on [PR #21724](https://github.com/CherryHQ/cherry-studio/pull/21724), targeting `DeJeune/openai-gemini-endpoints-implement` at `d5122ff4e47f6b76c53988263ff60e7cb858b016`. That parent is also the diagnostic baseline and provides connection inheritance and independent metadata controls. The parent PR targets `main`; this Spec contributes only its bilingual documentation triplet relative to that parent.

The dependency order is `main` → prerequisite #21724 → this Spec → the implementation layers below. The prerequisite need not merge before implementation starts after current-head Spec Approval; its changes are inherited through the stack. If the parent changes, rebase upstack and recheck the affected APIs, tests, and Spec approval requirements. The local ordinary-TTS prototype remains unmerged; its speech adapter and tests must be delivered and verified in the transport layer below. This Spec adds no product implementation. Proposed file locations that come from the prerequisite or prototype are identified as such in the work breakdown.

### Default descriptions and explicit overrides

Resolve each field from registry defaults, then explicit provider-model metadata, then user overrides. Remote metadata contributes only fields it actually describes; absence is not denial, and synchronization must preserve existing user overrides. A model's vendor identity alone does not establish its serving protocol.

Manual creation, batch creation, and synchronized import use the same main-process resolution owner. Reuse the existing model-resolution path for preview and the same rules during creation. Resolve each batch item separately. The renderer must not maintain an independent set of model defaults.

Keep displayed defaults separate from explicit draft overrides. Apply this to capabilities, modalities, and endpoints:

| Action | Meaning |
| --- | --- |
| Leave a field untouched | Omit its override |
| Explicitly clear capabilities | Submit `capabilities: []` |
| Change a field | Submit that field's override |
| Restore defaults | Remove that field's override instead of copying today's default |

Preserve the existing sparse storage semantics. Do not treat all empty arrays as omitted values or persist form touched-state. Removing an existing override must be represented deliberately by the edit/reset path; omission in an ordinary update is not a reset. No database schema change is planned.

Resolve on blur or submission rather than every keystroke. Bind results to the current provider and model ID; ignore stale responses and never overwrite explicit draft edits with asynchronous defaults. Defaults are recomputed when the identity changes. Explicit edits remain visible in the current draft and are revalidated against that identity; opening a different model starts its own draft. Unknown models remain manually configurable without name-pattern guesses.

A failed resolution is an error, not a successful unknown-model lookup. Submission waits for resolution of the current identity or reports failure; a retry must not create duplicate rows. Distinguish registry-derived prefill from an endpoint explicitly selected by the user or declared by the remote provider. Only the latter contributes an explicit endpoint selection. Batch forms resolve defaults per item and apply shared overrides only when the user has actually edited them.

### Endpoint suggestions and request selection

Use this precedence for endpoint suggestions:

1. Explicit user selection.
2. Explicit provider-model or remote endpoint metadata.
3. Known-model endpoint suggestions compatible with configured connections.
4. The provider's default LLM endpoint when applicable to the model.

Do not blindly copy canonical registry endpoints into arbitrary deployments. For example, a Gemini model hosted through an OpenAI-compatible service must not be forced onto Google transport. Preserve explicit incompatible choices and explain the missing connection instead of silently switching protocols. Add Speech endpoint and relevant speech metadata controls so unknown TTS models can be configured too; audio output alone does not prove suitability for ordinary read-aloud.

At invocation, validate the effective model description, choose an applicable endpoint from the model's supported endpoints, resolve its connection, and construct the SDK request for that target. Image generation/editing, embedding, and speech entry points already identify their request requirements and pass them to selection without a persisted operation field. Among applicable endpoints, honor an applicable explicit preference and otherwise preserve declared order. If none is applicable, report that configuration problem before sending.

Chat retains multiple LLM endpoints, their order, and endpoint-specific server tools. Non-chat requests must not unconditionally use `endpointTypes[0]`. Google `generateContent` may serve multiple tasks when the model description permits them. The selected target owns its SDK method, request path, dialect, and tool semantics.

Keep `resolveEndpointBaseUrl` and its existing precedence: target-specific address, compatible default LLM address, then deterministic compatible fallback. Preserve same-family inheritance, including image editing from image generation, and the explicit New API gateway compatibility exception. Do not copy inherited addresses back into explicit configuration or inherit unrelated source-endpoint tool capabilities.

| Configuration | Expected result |
| --- | --- |
| Google address and known Gemini image model | Image eligibility and Google `generateContent` using that address |
| OpenAI Chat address and `tts-1` | Speech endpoint using the inherited address |
| OpenAI address and known embedding model | Embedding eligibility and the appropriate endpoint |
| Chat and Images endpoints with separate addresses | Image requests use the Images address |
| Google-only connection with explicit OpenAI Images endpoint | Explain the missing compatible connection; do not send through Google |

### Explainability and existing data

Show the effective endpoint, address, and inheritance source in configuration details. Report known contradictions consistently during configuration and invocation; do not leave users with only an unexplained missing model. Registry suggestions are configuration defaults, not proof of a gateway's deployment, authorization, or account access.

Do not automatically repair old empty capability arrays or Chat selections: stored data cannot establish whether they were deliberate. Offer a preview of restoring default descriptions, apply only selected fields, and preserve unknown-model metadata. Reuse the current storage model; any later need for a schema change requires revisiting this proposal and an appended migration.

### Reset contract and save ordering

Extend the existing model PATCH DTO with an optional `resetFields` list restricted to `capabilities`, `inputModalities`, `outputModalities`, and `endpointTypes`. The command removes selected stored overrides; it does not persist this list or copy preview values into the row. An omitted list changes nothing. Reject a request that both resets and sets the same field, or attempts restoration for a model without a resolvable preset baseline, before making any write. Existing unknown-model descriptions remain intact.

Resolve the current baseline and update the selected columns in one synchronous database transaction. Clear `inputModalitiesExplicit` when resetting input modalities. Ordinary explicit arrays, including empty arrays, retain their current meanings. A reset follows the current baseline rather than pinning the preview snapshot; the preview explains that defaults may evolve. Do not expand reset into pricing, token limits, identity, enablement, or unrelated settings.

The edit drawer's per-model save queue serializes reset with pending edits. Earlier writes complete before reset, and subsequent edits apply afterward. Do not merge set/reset operations in a way that changes their order. A failed reset retains an actionable error and the current draft; switching models must not send a pending operation to the new identity. Only a successful response updates the displayed persisted result.

### Implementation sequence

1. After current-head Spec Approval, stack model-default resolution and sparse creation semantics on this Spec, inheriting the prerequisite routing/form work. Cover AC1, the creation portion of AC2, and AC8.
2. Stack request-target selection and ordinary cloud TTS on that layer. Cover AC3–AC7 and the routing portion of AC9. Verify the first two layers together so repaired capabilities do not mask incorrect routing.
3. Stack configuration explanations and selective reset on the transport layer. Complete AC2, AC9, and AC10 and the cumulative Electron scenarios. Keep reference documentation aligned; only the final layer with evidence for every AC moves this note to implemented.

### File-level work breakdown

| Owner | Change | Contract protected |
| --- | --- | --- |
| `src/main/data/services/ProviderRegistryService.ts` | Share default interpretation across preview, creation, and baseline reads; preserve the raw API model ID when matching a canonical model | Aliases do not collapse into another wire model; a preview agrees with a saved/reloaded model |
| `src/main/data/api/handlers/models.ts` and `src/main/data/services/ModelService.ts` | Apply the same baseline per item in create/reconcile; keep explicit overrides and add selected-field reset | Batch entries do not inherit another entry's metadata; omitted and empty fields stay distinct |
| `src/shared/data/api/schemas/models.ts` | Add the bounded reset command and reject contradictory set/reset fields | Validation precedes writes; no new database columns |
| `src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/` and `src/renderer/pages/settings/ProviderSettings/utils/modelSync.ts` | Separate defaults from overrides, guard asynchronous identity, add speech controls, and order reset with autosave | All creation paths agree; unrelated and undisplayed metadata survives editing |
| `packages/provider-registry/src/registry-utils.ts` | Own pure endpoint compatibility and suggestion rules; share connection-source selection with runtime and configuration consumers | Data services and renderer do not import `main/ai`; no duplicate URL-selection policy |
| `src/main/ai/provider/endpoint.ts` and `src/main/ai/AiService.ts` | Constrain endpoint selection using the actual image/edit/embedding request before SDK configuration | The SDK request uses the selected target and its explicit address |
| `src/main/ai/provider/endpointConnection.ts` from #21724 | Retain URL/full-path normalization while consuming the shared connection-source decision | Existing inherited roots and full-URL overrides retain their meanings |
| `src/main/ai/provider/speech.ts` and the custom Gemini speech adapter from the local prototype | Integrate ordinary TTS with the common routing rules and existing read-aloud flow | List eligibility and actual transport agree, including the explicit New API path |

Share only the pure connection-source decision in the registry; transport-specific SDK/path construction stays in Main. Configuration explanations expose the source endpoint and configured base address, never credential material. Provider context used for suggestions must include its effective endpoint configuration, not just vendor identity or default LLM type. Resolve this context once per provider in a batch rather than adding per-model database reads.

Check the installed SDK adapters before changing target selection. Google `generateContent`, Imagen, Google embeddings, and OpenAI-compatible image implementations do not all have identical wire methods. Preserve established adapter contracts and use the existing SDK model constructors; a broad task filter must not reject an already-supported route. Image editing uses the actual request shape and declared model support, not the presence of a custom image URL alone.

### Verification plan

These are planned checks, not completed implementation evidence. Existing test names below refer to the diagnostic worktree; `endpointConnection.test.ts` and `modelMetadataForms.test.tsx` come from #21724, while `speechModels.test.ts` comes from the local TTS prototype.

| Verification owner | Explicit test locations | Observable evidence |
| --- | --- | --- |
| Model data | `src/main/data/services/__tests__/ProviderRegistryService.test.ts`, `ProviderRegistryService.context.test.ts`, `ModelService.test.ts`; `src/main/data/api/handlers/__tests__/models.test.ts` | Real persisted/reloaded metadata, original API IDs, deliberate empty arrays, mixed batches, atomic reset rejection, and untouched unrelated fields |
| Model forms and import | `src/renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/__tests__/modelMetadataForms.test.tsx`, `EditModelDrawer.test.tsx`; `src/renderer/pages/settings/ProviderSettings/utils/__tests__/modelSync.test.ts` | Correct default display, stale-response rejection, explicit overrides, selected-field preview, and autosave/reset ordering |
| Endpoint transport | `src/main/ai/provider/__tests__/endpoint.test.ts`, `endpointConnection.test.ts`, `config.test.ts`, `googleImageModel.test.ts`; `src/main/ai/voice/__tests__/speechModels.test.ts` | Actual SDK URL, request body, wire model ID, parsed image/audio/embedding result, and no request on incompatible configuration |
| Feature consumers and chat | `src/renderer/pages/paintings/hooks/__tests__/usePaintingProviderOptions.test.ts`; `src/renderer/pages/settings/VoiceSettings/__tests__/VoiceSettings.test.tsx`; `src/shared/utils/__tests__/provider.serverTools.test.ts` | Function selectors accept the new models while LLM order and endpoint-specific server tools remain correct |

Use `setupTestDatabase()` with production migrations for persistence tests. Replace only the remote network in transport integration tests; asserting a mock call alone does not establish the contract. Add affected Knowledge Base consumer coverage where the actual embedding selection path requires it. Run per-project commands with explicit test files, changed-file lint/format checks, relevant type checks, documentation impact inspection, and `docs:check`; do not run the full local test suite.

In a verified workspace Electron profile, use local HTTP fixtures to exercise Google image creation, OpenAI TTS read-aloud, embedding address inheritance, separate image generation/edit addresses, unknown-model configuration, incompatible connections, and selected-field reset. Capture UI state, outgoing requests, persisted results, and screenshots. Keep real cloud authorization and audio-quality acceptance separate from simulated HTTP evidence. Record actual checks per AC in the implementation PRs; the Spec PR validates documentation only.

## Alternatives considered

- Ignore all empty arrays in the service: rejects deliberate user clearing and hides the producing form defect.
- Add image/TTS-specific URL workarounds: duplicates connection rules across consumers and leaves other creation paths broken.
- Add protocol configuration or provider category flags: duplicates existing endpoint connections and cannot describe per-model deployment differences.
- Copy every canonical model endpoint or infer protocols from names: mistakes model origin for the hosting service's contract.
- Automatically rewrite existing rows or reject every ambiguous compatible address: loses unrecorded user intent or changes established fallback behavior without evidence that it is necessary.

## Acceptance criteria

- AC1 — The same known model added manually, in a batch, or by import has equivalent effective metadata when no explicit overrides are made. (verification: renderer and real database tests; owner: model creation)
- AC2 — Untouched defaults do not become overrides; explicit clearing remains empty; restoring a field removes its override and follows defaults, including the input-modality explicit flag. Contradictory set/reset requests fail without writes. (verification: renderer and real database tests; owner: model persistence)
- AC3 — A known Gemini image model added with only its ID and a Google connection appears in painting and sends `generateContent` to that connection. (verification: Electron with local mock HTTP; owner: painting)
- AC4 — Known OpenAI TTS inherits an OpenAI LLM address and requests `audio/speech`; an unknown TTS model can be configured through the form and selected for read-aloud. (verification: renderer and mock HTTP integration; owner: voice)
- AC5 — A known embedding model is selectable in Knowledge Base and uses the appropriate inherited or explicitly overridden endpoint address. (verification: renderer and mock HTTP integration; owner: embeddings)
- AC6 — Unrelated edits preserve multiple LLM endpoints and their order; switching endpoints selects the corresponding server-tool behavior. (verification: renderer and shared/main tests; owner: chat routing)
- AC7 — Image generation/editing respects applicable target endpoints and explicit addresses; Google-only connections cannot supply OpenAI image requests through ordinary fallback. (verification: main integration with mock HTTP; owner: endpoint routing)
- AC8 — Stale default-resolution results cannot replace current identity or explicit edits; failed lookups are not treated as unknown models; unknown models remain editable without forced protocol guesses. (verification: renderer tests; owner: model forms)
- AC9 — Configuration shows the effective connection source and explains missing compatible connections; same-family and explicit New API inheritance remain usable. (verification: renderer and main integration tests; owner: provider settings)
- AC10 — Existing rows remain unchanged until a user applies previewed default restoration, which updates only selected fields; queued saves cannot reorder reset or redirect it to another model, and failure does not appear as success. (verification: renderer and real database tests; owner: model persistence)

## Risks

Registry descriptions may be incomplete or differ from a gateway's deployment. Explicit overrides and meaningful request failures remain necessary; do not infer universal support from an address. Broad endpoints such as `generateContent` need model-level task information to distinguish image and speech use.

Sparse overrides intentionally allow untouched defaults to evolve with registry updates. Existing accidental overrides remain until a user chooses to reset them. Endpoint suggestion changes must preserve explicit remote metadata, multi-endpoint order, and server-tool distinctions.

Local mock HTTP proves routing and response handling, not real cloud access or audio quality. The earlier diagnostic results are baseline evidence, not verification that these acceptance criteria have been implemented. This note records a proposed target and does not mark implementation complete.
