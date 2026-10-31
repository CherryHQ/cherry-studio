# Agent Note: Per-model reasoning capability overrides

Status: proposed

English | [中文](2026-10-27-per-model-reasoning-capability.zh.md)

## Problem

Issue #22726 records one endpoint rejecting `max`. The attempted repair capped the global `gpt-5-6-luna` declaration at `xhigh` and restored `max` only for the OpenAI preset. This incorrectly restricts custom endpoints that support `max`, while a relay bound to that preset can still reject it. Model names and preset bindings cannot establish actual endpoint capability.

The existing `user_model.reasoning` JSON contains system-inferred metadata, including inferred custom-model controls; it does not record explicit user intent. Model CRUD and the editor do not expose reasoning shape or supported-level overrides. Model reads and request construction resolve profiles separately, so an editor alone cannot ensure that displayed choices match final requests.

This is a new feature decision; the active Agent Note tree has no existing owner for per-model reasoning overrides. Its persistence and serialization contracts require human approval before implementation under the [proposed-note rules](../AGENTS.md).

## Proposal

### Restore catalog facts

Restore the upstream `gpt-5-6-luna` declaration, including `max`. Remove the global `xhigh` cap and the OpenAI overrides introduced solely to restore `max`. Keep legitimate pre-existing endpoint contracts. Registry declarations remain defaults; explicit user configuration expresses actual endpoint differences. Never infer those differences from model names or OpenAI preset binding.

Keep the nearest-level repair already in this PR independently, using the effective concrete-level list rather than a globally reduced catalog list.

### Persist explicit intent separately

Append a migration adding nullable JSON column `reasoningOverrides` to `user_model`; never rewrite a shipped migration. Existing rows start with `null`. Keep `reasoning` as system-inferred metadata and never promote its contents into user intent. The existing row's provider/model identity owns the override, including preset-backed rows; the same model ID under another provider is a separate scope.

The JSON contains optional model-level fields and an optional map keyed by the existing endpoint-type enum, whose entries accept the same fields. Expose only typed inputs for reasoning parameter emission enabled/disabled, format type, wire dialect, concrete effort levels, independent Off/Auto availability, and thinking-token limits for budget profiles. Unknown fields and enum values are rejected. `selectableEfforts` is read-only derived output, never a writable or separately persisted source of truth.

Extend existing model create/update DataApi schemas, DTOs, and ModelService read/write paths. Explicit edits persist even when equal to current registry defaults, and survive reconciliation and catalog refresh. Metadata inference must never overwrite them. Omitted patch fields preserve existing values; `null` clears the whole column. Within the override, explicit field deletion restores that field's inheritance, and endpoint-entry deletion restores model-level/registry inheritance for that endpoint. The update contract must express deletion separately from omission and an empty list.

### Resolve one effective configuration

Use one main-process resolver owned by ProviderRegistryService, taking the actual provider row, model row, and resolved outgoing endpoint. Apply this precedence per field:

1. User endpoint override.
2. User model-level override.
3. Registry endpoint contract.
4. Registry model declaration for support / endpoint default profile for wire encoding.

Absent fields inherit. Explicit concrete levels replace the entire inherited list, never union with it. Resolve support and shape together, validate their compatibility, then derive wire profile, mode availability, `selectableEfforts`, and summary availability. An explicit format/dialect choice selects its matching existing profile instead of retaining lower-priority contract operations from the old shape. Without a user shape choice, preserve existing endpoint contracts and Responses summary settings.

Model reads expose the resolver's projection for the selected actual endpoint. Endpoint changes require a fresh projection. UI candidates, stored-selection convergence, and final encoding consume this same effective result. Requests resolve current persisted overrides and the actual outgoing endpoint again to avoid stale UI state. No consumer may overwrite the result with catalog-only support or independently infer another vocabulary. Gateway native fast paths must respect active overrides rather than bypass them.

| User operation/state                  | Effective meaning                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Concrete levels `[]`                  | No selectable concrete intensity tiers; no fallback to inherited levels. Default and independently permitted Off/Auto keep their profile semantics. If no concrete tier exists, a stale concrete choice uses Default at display/submission time. |
| Reasoning parameter emission disabled | Hide reasoning controls and emit no reasoning parameters, including default operations. This does not promise that the server stops internal reasoning and differs from sending Off. Preserve other override fields for re-enabling.             |
| Clear override / restore defaults     | Delete explicit fields/entries, or set the whole column to `null`; inherit the current registry and remaining parent overrides. Never snapshot defaults or change the saved effort choice to Default.                                            |

### Closed shape scope and adapter compatibility

Shape is a finite selection of existing `ReasoningFormatType` and `ReasoningWireDialect` profiles in `packages/provider-registry/src/reasoningProfiles.ts`. Interpreter operations and target paths are not user input. The initial compatibility matrix is:

| Format type        | Allowed explicit wire dialects                                  | Endpoint / supported outbound adapter                                      | Final HTTP body contract                                                                                                                                       |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-chat`      | `effort`                                                        | `openai-chat-completions`; AI SDK OpenAI Chat or OpenAI-compatible adapter | `reasoning_effort`; no Responses `reasoning.effort` envelope                                                                                                   |
| `openai-responses` | `effort`                                                        | `openai-responses`; AI SDK OpenAI Responses or Open Responses adapter      | `reasoning.effort`; summary follows existing endpoint summary settings                                                                                         |
| `anthropic`        | `effort`, `budget`, `adaptive-always`, `adaptive-between-tools` | `anthropic-messages`; AI SDK Anthropic adapter                             | Existing adaptive `thinking` plus `output_config.effort`, or enabled `thinking` with `budget_tokens`; preserve existing always-on/between-tools mode contracts |
| `gemini`           | `effort`, `budget`                                              | `google-generate-content`; AI SDK Google adapter                           | `generationConfig.thinkingConfig` uses `thinkingLevel` or `thinkingBudget` respectively, never both                                                            |
| `ollama`           | `effort`                                                        | `ollama-chat`; existing Ollama adapter                                     | `think` uses existing boolean/tier encoding                                                                                                                    |
| `none`             | No dialect                                                      | Any endpoint above through its listed adapter                              | No reasoning parameters                                                                                                                                        |

An omitted dialect retains a compatible inherited dialect or the format's existing default. Unsupported explicit combinations fail validation, never silently select another shape. After endpoint overrides, model-level choices must be compatible with every enabled endpoint; endpoint entries can resolve protocol differences. Validate both endpoint type and adapter identity. Vendor-specific registry contracts remain unchanged without user shape choices; their raw descriptors do not become editable.

AI SDK chat and API Gateway egress support the matrix and use the same resolver. Pi and Claude Code can honor overrides through their existing Gateway routes, where the actual target provider/model and endpoint own final encoding. Their direct SDK paths are not advertised as arbitrary shape transports: an active override on an unsupported direct route must fail clearly before HTTP, identifying the Gateway route as supported. Do not silently ignore overrides or automatically reroute. Routes without overrides retain existing behavior. Verify route boundaries as well as outgoing adapters.

Do not introduce arbitrary JSON templates, JSONPath, expressions, endpoint probing, automatic detection, or new wire dialects. Budget shapes reuse existing token-limit, fallback, and output-token clamping policies; validate explicit limits and mode availability against the chosen profile. Never advertise a mode the adapter cannot encode. If an adapter cannot carry a listed profile, fix that adapter upstream before claiming support; SDK provider-options assertions alone cannot establish success.

### Editing and convergence

Add a reasoning section to the existing model editor using shared UI components and localized strings. Start with inheritance and show effective values and sources. Allow model-level or endpoint-targeted edits, compatible shape and concrete-level selection, and independent Off/Auto settings. Validate before saving. Provide per-field inheritance, endpoint reset, and full restore-default actions using the deletion semantics above; refresh the active endpoint projection after save/reset.

Keep the existing nearest-concrete-level mapping, its ordering, and its tie rule. Only concrete intensities (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`) from the effective list participate. Default (`default`), Off (`none`), and Auto (`auto`) are modes, never distance-mapping candidates. Preserve existing profile-specific semantics, including omission when a requested mode is unavailable; nearest-level mapping must not turn a mode into a concrete tier. Toggle-only controls remain Off/Auto controls without synthetic tiers.

Convergence is read-only for every stored selection, including this model's own value. Display the effective converged choice and submit it through the same resolver. Configuration or endpoint changes must not rewrite an assistant, topic, another model, or another endpoint. Explicit user selections retain existing save behavior. Returning to a `max`-capable endpoint therefore exposes the retained `max` selection again.

### Accepted transition

Removing the global cap restores `max` before this feature is available. Issue #22726's rejecting endpoint can therefore return HTTP 400 again until its user explicitly configures supported levels for that provider/model or endpoint. Human review explicitly accepts this intermediate state. Do not conceal it by reinstating a global cap, preset-only restoration, or endpoint inference.

## Alternatives considered

- Reuse `user_model.reasoning` with an explicit override subobject: avoids a column migration but mixes inferred metadata and user intent, requiring every metadata rewrite to preserve both. Prefer a separate nullable column and appended migration.
- Globally cap Luna at `xhigh`, with or without OpenAI restoration: rejected because one relay's rejection does not redefine model capability and preset identity cannot prove endpoint support.
- Edit a separate `selectableEfforts` list or union user/catalog levels: rejected because these create conflicting truth or reintroduce excluded levels.
- Snapshot defaults on reset or rewrite stored choices on convergence: rejected because defaults stop inheriting updates and endpoint-local restrictions erase choices used elsewhere.
- Arbitrary wire templates or automatic capability detection: excluded because finite existing profiles offer a typed, verifiable boundary without a new template language or probing contract.

## Acceptance criteria

- AC1 — A custom `max`-capable Luna endpoint sends `max` without overrides and after explicit `max` configuration; explicit levels determine behavior identically with and without OpenAI preset binding, and catalog Luna includes `max` without a compensating OpenAI override. (verification: registry unit + main resolver + captured HTTP; owner: registry and AI SDK integration)
- AC2 — Explicitly limiting an endpoint to `xhigh` makes a stored `max` display as `xhigh` and sends `xhigh` in the final HTTP request; cover both preset-binding states and OpenAI Chat/Responses endpoints. (verification: renderer + captured HTTP; owner: model controls and AI SDK integration)
- AC3 — Overrides obey field-level precedence, lists replace rather than union, and changing one provider/model/endpoint leaves other scopes intact; convergence never rewrites any stored effort, including this model's own value, and returning restores the retained choice. (verification: resolver unit + real database + renderer; owner: ModelService and model controls)
- AC4 — Every supported shape/dialect in the matrix takes effect in real HTTP bodies through both AI SDK chat and Gateway egress, with no incompatible old-shape fields; invalid endpoint/adapter combinations fail clearly, Pi/Claude Gateway routes honor overrides, and unsupported direct routes fail before HTTP instead of ignoring them. (verification: adapter HTTP capture + route integration; owner: AI SDK, Gateway, Pi, and Claude Code integrations)
- AC5 — Explicit configuration survives model re-read, catalog refresh, reconciliation, and application restart; reset deletes overrides and re-inherits the current registry; populated-database migration preserves old metadata/business rows and initializes overrides to `null`. (verification: file-backed database migrate-forward + Electron restart; owner: model persistence)
- AC6 — Default/Off/Auto, toggle-only controls, `minimal`/`ultra`, and nearest-level tie behavior retain their contracts; empty levels, disabled emission, and cleared overrides have distinct observable outcomes, and modes never undergo nearest-level mapping. (verification: resolver/serializer unit + renderer + HTTP capture; owner: reasoning controls and serialization)
- AC7 — Official OpenAI and other models without overrides retain registry-defined candidates and outgoing requests, including Chat/Responses behavior and Responses summary settings; inferred legacy `reasoning` never becomes a user override. (verification: focused model-read and HTTP regressions; owner: registry and model/runtime integrations)
- AC8 — The editor exposes inheritance sources, endpoint targeting, independent Off/Auto controls, validation, and reset actions; candidates, displayed convergence, and final encoding match one main resolver result after saves, resets, and endpoint changes, without a writable `selectableEfforts` copy. (verification: DataApi schema + renderer + Electron and HTTP integration; owner: model editor and effective-config resolver)

## Risks

- Restoring catalog truth deliberately re-exposes Issue #22726's HTTP 400 until explicit endpoint configuration. Explain inheritance and reset without claiming endpoint support was detected.
- SDK adapters can rename/drop provider options, and Gateway fast paths or direct agent routes can bypass projection. Final HTTP capture and route-boundary checks are required; provider-options assertions are insufficient.
- Catalog refresh, stale renderer data, and differing endpoint selection can overwrite user intent or display a vocabulary different from the request. Resolve actual endpoints consistently and keep convergence read-only.
- The appended migration and CRUD contract must preserve populated databases and distinguish deletion from omission. Historical metadata has no reliable user-intent provenance and must remain metadata.
- Profile-specific budgets and modes can make individually valid fields incompatible together. Validate the whole effective configuration; future profile expansion requires a separately reviewed compatibility and HTTP-evidence update.
