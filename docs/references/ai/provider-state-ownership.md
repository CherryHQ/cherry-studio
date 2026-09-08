---
description: Ownership rules for provider facts, endpoint dialects, user connection overrides, and per-request controls
sources:
  - packages/provider-registry/src/schemas/provider.ts
  - src/shared/data/types/provider.ts
  - src/main/data/services/ProviderRegistryService.ts
  - src/main/data/services/ProviderService.ts
  - src/main/ai/runtime/aiSdk/params
---

# Provider State Ownership

Provider state follows one rule: **one fact has one authoritative home**. Do
not pair a capability boolean in one object with its value in another. That
shape lets the two drift until the UI advertises a control that cannot reach
the wire, or a migrated value keeps affecting requests after its editor has
disappeared.

## The four ownership layers

| Layer | Authoritative home | What belongs here | Test |
|---|---|---|---|
| Provider fact | `packages/provider-registry/src/providers/*.ts` | Facts that stay true for every user of that host: reported-cost authority, currency, native tools, Fast transport | Would changing the user or API key leave it unchanged? |
| Endpoint fact | `endpointConfigs[endpointType]` | Protocol implementation details: base URL, adapter family, reasoning wire, request-control wire mappings, model-list URL, dialect deviations | Could two endpoints on the same provider answer differently? |
| Connection override | `user_provider.endpoint_configs` and other provider-row connection fields | User-owned long-lived configuration: custom base URL, auth, timeout, and custom-host dialect overrides | Does the user configure it once for this connection? |
| Request choice | `assistant.settings.*`, `agent.configuration.*`, or `feature.<name>.*` Preference for a surface with no assistant (translate) | Choices that can change per request: reasoning effort, summary detail, service tier, and sampling | Could the user reasonably choose another value for the next request? |

Model capabilities and parameter support remain model or provider-model facts
in the model registry. They do not move onto the provider row merely because a
request builder consumes them.

## Endpoint dialects

`EndpointConfig.dialect` describes how one hosted endpoint deviates from its
protocol. It is deliberately endpoint-scoped: a relay may accept a developer
role on Responses while rejecting it on chat-completions, and
`stream_options` exists only on chat-completions.

Registry-backed providers inherit the current registry dialect at read time.
Rows store only user deltas, merged key by key by `ProviderRegistryService`.
Custom providers can persist the same override shape without inventing a
provider-wide capability bag.

## Request controls

A request control's visibility and serialization must come from the same
declaration. The reasoning-summary control is the reference pattern:

1. The endpoint reasoning wire declares the `reasoningSummary` operation and
   its accepted values.
2. `ProviderRegistryService` projects those values into runtime reasoning
   controls.
3. The surface renders the control only when that projection exists —
   `ModelSpeedControl`, shared by the composers and the translate page.
4. The selected value lives with whoever owns the request, the assistant or the
   feature's own preference, and the same wire operation emits it.

Do not add a parallel `supportsX` boolean. If the wire has no operation, the UI
must not show the control; if the wire has one, the operation already proves
support and defines how the value is sent.

Service tier follows the same ownership split. The endpoint registry owns the
supported canonical choices, default, native-value mapping, and whether the
value is delivered through provider options or the top-level request body. A
provider-model override may only replace the choices. Assistant and Agent JSON
store the user's canonical `standard | auto | fast | flex` selection, and each
turn freezes that selection before Main translates it at the terminal provider
adapter. Wire details are never exposed to the renderer or persisted on the
provider row.

Service tier is separate from the product's existing Fast Mode. Fast Mode is a
per-turn transport switch for provider-model pairs that declare
`supportsFastMode`; service tier is an endpoint request control with four
shared semantic values. A provider must not use both mechanisms for the same
choice.

## Examples removed by this rule

- `provider.settings.summaryText` had readers but no writer. Summary support
  now comes from the endpoint wire and the value from assistant settings.
- `provider.settings.serviceTier` and `provider.settings.verbosity` were
  writable only by the v1 migrator, leaving upgraded users with invisible
  state. Service tier now uses the endpoint-owned request-control contract and
  Assistant/Agent selection described above; verbosity needs a request-control
  design before it returns.
- `apiFeatures.arrayContent` had declarations and an editor but no consumer.
  The SDK already serializes the only valid string-versus-array distinction, so
  the flag was removed.
- `apiFeatures.reportsActualCost` was not a request feature at all. It is now a
  top-level provider fact consumed directly by usage accounting.

## Adding provider-related state

Before adding a field, answer in order:

1. Is this intrinsic to the model? Put it in model or provider-model data.
2. Is it invariant for the host? Put it on the registry provider.
3. Can it differ by protocol endpoint? Put it on that endpoint config.
4. Is it user connection configuration? Persist only the user-owned delta.
5. Can it vary per assistant or request? Declare the wire operation and project
   a request control from it.

If none fits, the field probably lacks a concrete consumer and should not be
added yet.

## Related references

- [Adapter Family](./adapter-family.md)
- [Provider Resolution](./provider-resolution.md)
- [Params Pipeline](./params-pipeline.md)
