# Reasoning control architecture

This document defines the ownership, data flow, and request-encoding contract for reasoning controls.
The migration may temporarily contain legacy fields and serializers, but new code must follow this contract.

## Goals

- A model describes **what reasoning controls it supports**.
- A provider endpoint describes **how those controls are encoded**.
- The renderer receives only the model capabilities needed to render the control.
- The main process resolves one immutable reasoning invocation per request.
- Native AI SDK options, compatible-provider options, API Gateway requests, and Claude Agent SDK requests share
  one canonical selection vocabulary.

The design deliberately does not introduce a second model-family taxonomy for request encoding. A provider endpoint
owns its protocol default, while a provider-model row carries an endpoint-keyed contract whenever that endpoint
narrows the model's controls or uses a different wire shape.

## Non-goals

- No arbitrary JSONPath, expression language, or user-authored parameter template.
- No provider wire profile in SQLite, DataApi, renderer state, or user-provider configuration.
- No custom-model reasoning-control editor in the model drawer.
- No user-selectable `reasoningFormatType` in the custom-provider connection drawer.
- No runtime request serializer that identifies a model with regular expressions.
- No compatibility dual-write for legacy `model.reasoning.type` or endpoint `reasoningFormatType` fields.

## Vocabulary

### Canonical selection

All entry points use the same user selection:

```ts
type ReasoningSelection = 'default' | 'none' | 'auto' | ReasoningEffort
```

`ReasoningEffort` is the closed registry vocabulary such as `minimal`, `low`, `medium`, `high`, `xhigh`, and
`max`. The selection is an intent, not a provider request field.

- `default`: omit an explicit choice and let the target's declared default behavior apply.
- `none`: explicitly disable reasoning when the model and endpoint support it.
- `auto`: ask the target to choose a reasoning depth or budget.
- effort: request a normalized discrete effort.

### Intrinsic model controls

`reasoning.controls` is the source of truth for what a model can do:

```ts
type ReasoningControl =
  | { kind: 'effort'; values: ReasoningEffort[]; default?: ReasoningEffort }
  | { kind: 'budget'; min: number; max: number; default?: number }
  | { kind: 'toggle'; default?: boolean }
```

The model may also carry intrinsic metadata such as its default behavior and thinking-token bounds. It must not
carry a provider format, target field name, or serialization protocol.

The runtime model exposes `selectableEfforts`, derived during registry enrichment. This is the only effort list the
renderer consumes. UI helpers add `default`; they do not inspect model IDs, provider IDs, endpoint formats, or
adapter families.

### Endpoint wire profile

A wire profile is main-only registry data describing how a normalized invocation becomes provider parameters. It
contains a closed set of modes (`default`, `off`, `auto`, `effort`) and emission operations.

An operation can write only a reviewed target from the schema, for example:

- `reasoningEffort` or `reasoning_effort`;
- `reasoning.*` or `thinking.*`;
- `enable_thinking`, `thinking_budget`, or `incremental_output`;
- `disable_reasoning`;
- reviewed `chat_template_kwargs.*` or `extra_body.*` leaves;
- native `thinkingConfig.*`, `reasoningConfig.*`, or `think` leaves.

An operation value can come only from:

- a literal;
- the normalized effort;
- the resolved and clamped budget;
- the assistant's reasoning-summary preference.

Profiles cannot execute expressions or write arbitrary paths.

### Resolved invocation

The main resolver combines the canonical selection, intrinsic model controls, endpoint profile, and request budget
context into one immutable `ResolvedReasoningInvocation`. It records:

- whether the request omits reasoning, disables it, uses auto, uses effort, or uses a token budget;
- the normalized effort after vocabulary mapping;
- the resolved budget after model bounds and request `maxTokens` clamping;
- the closed emission operations to apply.

Encoders consume this result. They do not perform model/provider detection themselves.

## Ownership

| Concern | Owner | Persisted where |
| --- | --- | --- |
| Reasoning capability | Creator/model schema | Generated `models.json` and runtime model |
| Effort vocabulary | `reasoning.controls` / runtime `selectableEfforts` | Generated controls plus runtime projection |
| Budget limits and model default | Model reasoning metadata | Generated model data |
| Endpoint protocol and adapter | Provider `endpointConfigs` | Generated `providers.json` |
| Wire encoding | Endpoint/format profile | Provider registry and main memory only |
| Exact provider-model capability/wire exception | `ProviderModelOverride.reasoningContracts[endpoint]` | Generated `provider-models.json` |
| User's default selection | Assistant settings | DataApi/SQLite |
| Selection for one send | Request/queue snapshot | In-memory transport payload |

Provider connection rows persist connection facts such as base URL and adapter family. They do not persist a
reasoning format selector.

## Model enrichment and `reasoning-families*`

The files under `src/patterns/reasoning-families*` enrich model capabilities; they are not request-encoding
profiles.

```text
src/creators/*.ts reasoningFamilies
              │
              ├─ generate models.json reasoning.controls
              │
              └─ generate reasoning-families.gen.ts
                              │
                              └─ enrich an unmatched/custom model at the model-service boundary
```

### `reasoning-families.gen.ts`

This generated file is a flattened runtime artifact of creator-declared rules. Do not edit it directly. It exists
so runtime custom-model enrichment can use the rule data without importing creator modules and their build-time API
fetchers.

### `reasoning-families.ts`

This is a pure matcher. It contains no provider serialization behavior. Given a model ID and a rule list, it can:

- infer an effort/toggle vocabulary;
- infer a budget range independently;
- combine the first matching vocabulary rule with the first matching budget rule.

Regular expressions are allowed only in catalog generation and custom-model enrichment in `ModelService`. The
result is materialized as runtime model metadata before reasoning request resolution. The resolver and encoder
must not import the generated rule table or matcher.

## Endpoint-keyed contracts without a wire-family taxonomy

The global format catalog contains protocol defaults only: OpenAI Chat, OpenAI Responses, Anthropic, Gemini,
Ollama, and an explicitly disabled profile. It contains no provider names, model owners, control-kind matching, or
model-family rules.

Request-time resolution first determines the effective endpoint, then applies this fixed precedence:

1. `ProviderModelOverride.reasoningContracts[endpoint].wire`;
2. the provider endpoint's inline `reasoningFormat.wire`;
3. the exhaustive global default for `reasoningFormat.type`.

The matching contract's `support.controls` replaces the intrinsic model controls for that endpoint; other support
fields override their intrinsic counterparts individually. This lets an endpoint expose a narrower effort vocabulary
without putting provider protocol facts on the creator model.

Unknown/custom models may still receive intrinsic controls from model-ID enrichment, but their requests use only the
endpoint's standard protocol. Non-standard fields require a registry contract or explicit custom parameters.

## Registry generation contract

Reasoning changes follow the normal registry source/artifact boundary:

- edit `src/creators/*` for model capabilities and controls;
- edit `src/providers/*` for endpoint wire behavior;
- edit `reasoningContracts[endpoint]` on a provider override for an exact provider-model exception;
- edit schemas/profile catalogs when adding a new closed operation;
- run `pnpm generate` in `packages/provider-registry`;
- never hand-edit `data/*.json` or `reasoning-families.gen.ts`.

Legacy endpoint `reasoningFormatType` and model `reasoning.type` values are ignored when read and disappear on the
next normalized write. They do not require a SQLite migration or compatibility write path.

## Standard Chat data flow

### Selection and persistence

1. `ThinkingButton` renders from `runtimeModel.reasoning.selectableEfforts` and adds `default`.
2. A selection updates `assistant.settings.reasoning_effort` through the existing assistant DataApi mutation. This
   is the default for future messages.
3. Composer submission also snapshots the current value into
   `ComposerQueuedMessagePayload.reasoningEffort`.
4. `AiChatRequestBody`, `AiStreamOpenRequest`, and `IpcChatTransport` explicitly carry that optional snapshot.
5. Main computes the effective value as:

   ```ts
   request.reasoningEffort ?? assistant.settings.reasoning_effort ?? 'default'
   ```

6. The request snapshot affects only that invocation; it is never written back to the assistant.

The snapshot closes the race where a user changes the control and immediately submits before the assistant update
finishes. Queued messages and pending steer entries retain the value captured with their user message instead of
reading the latest UI state when they eventually execute.

Commands without a new composer submission, such as regeneration or approval continuation, use the assistant's
current setting at execution time. They do not add historical reasoning persistence.

### Main request assembly

```text
request snapshot + assistant fallback
                  │
                  ▼
       reasoning resolver ───── model intrinsic controls
                  │             endpoint/profile + maxTokens
                  ▼
    ResolvedReasoningInvocation
                  │
                  ▼
      closed emission encoder
                  │
                  ▼
       adapter-owned providerOptions namespace
                  │
                  ▼
        Agent → AI SDK adapter → HTTP
```

`buildAgentParams` resolves the endpoint, adapter, `aiSdkProviderId`, and wire profile once and stores them in the
request scope. Later builders consume that scope rather than repeating adapter or profile inference.

The merge order is:

```text
profile-generated parameters < assistant customParameters < request callOverrides
```

This lets explicit per-call input win without allowing stale assistant persistence to override the current send.

## Native AI SDK path

Native profiles emit AI SDK provider option fields. These still live under the adapter's
`providerOptions` namespace because the common AI SDK Chat call has one provider-options surface:

| Adapter | AI SDK input |
| --- | --- |
| OpenAI | `providerOptions.openai.{ reasoningEffort, reasoningSummary }` |
| Anthropic | `providerOptions.anthropic.{ thinking, effort, sendReasoning }` |
| Gemini | `providerOptions.google.{ thinkingConfig / thinkingLevel }` |
| xAI | `providerOptions.xai.{ reasoningEffort }` |
| Bedrock | `providerOptions.bedrock.{ reasoningConfig }` |
| Ollama | `providerOptions.ollama.{ think }` |

These are SDK inputs, not final HTTP JSON. The provider adapter performs its own camelCase-to-wire conversion. The
emission encoder cannot query a model ID, provider ID, creator regex, or family regex.

## Generic compatible-provider path

For an OpenAI-compatible or otherwise generic endpoint, the same resolved invocation produces parameters close to
the endpoint's HTTP shape. They are placed under the language model's actual AI SDK provider-options namespace.
For `createOpenAICompatible({ name })`, this is `providerOptions[name]`, not
`providerOptions['openai-compatible']`: the SDK validates the canonical namespace against its closed option schema,
while it forwards unknown wire fields such as `thinking` only from the concrete provider namespace.

The closed profile may emit reviewed fields such as `reasoning_effort`, `thinking_budget`, or nested `extra_body`.
The existing custom-parameter merge remains the boundary for user-supplied parameters, including the established
`openai-compatible` `reasoning_effort` to `reasoningEffort` compatibility conversion.

The generic path does not consult `model.reasoning.type` or branch on provider/model identifiers.

MiniMax-M3 is a toggle-control example: `default` omits `thinking`, `none` emits
`thinking.type = 'disabled'`, and `auto` emits `thinking.type = 'adaptive'`. MiniMax M2.x remains fixed-reasoning
because its API does not allow thinking to be disabled. See the
[MiniMax OpenAI-compatible API](https://platform.minimaxi.com/docs/api-reference/text-chat-openai).

## API Gateway

OpenAI, Anthropic, and Gemini inbound fields are first normalized into the canonical selection/invocation model.
The gateway then calls the same main-only resolver used by Standard Chat.

- Same-dialect Anthropic/Gemini fields may be preserved losslessly.
- Cross-dialect requests are encoded with the target endpoint profile.
- The result enters `callOverrides.providerOptions`, preserving its highest merge priority.
- The gateway does not construct a temporary Assistant solely to reuse a reasoning builder.

After mapping, the request uses the normal `buildAgentOptions → Agent → AI SDK adapter` path.

## Agent Session and Claude Agent SDK

Agent Session uses the same composer snapshot but does not use AI SDK `providerOptions`:

1. `AgentComposer` writes `reasoningEffort` into the queued message payload.
2. IPC carries it in `BeginAgentSessionTurnInput`.
3. Main resolves an Anthropic invocation.
4. The Claude Agent SDK `query()` call receives native `Options.effort` and `Options.thinking`.

`sendReasoning` is an AI SDK Anthropic option and is ignored on this path. The effort type includes Claude's
supported `xhigh` value.

Reasoning selection is connection/spawn-frozen state and participates in the query rebuild signature:

- prewarm uses `default`;
- the same selection reuses the current Query;
- a changed selection rebuilds before the next turn;
- a busy message with the current selection may use native redirect/steer;
- a busy message with a different selection is queued for the next turn, then runs after rebuild.

Pending turns store the selection beside the user message. The deprecated token-only
`setMaxThinkingTokens` mechanism is not used.

When Claude Code runs through the internal gateway, the Claude SDK still sends Anthropic-native fields. The gateway
normalizes them and applies the destination provider profile.

## Adding or changing reasoning support

### A model gains a new control

1. Update the owning creator's model or `reasoningFamilies` declaration.
2. Keep only intrinsic facts: effort values, budget range, toggle, and defaults.
3. Regenerate the catalog.
4. Confirm the runtime `selectableEfforts` contract exposes only supported choices.

### A provider uses a different request shape

1. Update the provider endpoint's protocol default when every model on that endpoint uses the same wire.
2. Add an endpoint-keyed provider-model contract when the accepted controls or wire differ by model.
3. Group exact model IDs with local constants in that provider source; do not create a shared wire-family matcher.
4. Add a new target to the closed schema only when no reviewed target can express the protocol.
5. Regenerate the catalog.

### A new reasoning format is added

1. Add the format discriminator.
2. Add its exhaustive global profile.
3. Extend the closed target/value operation set only if the existing operations cannot represent it.
4. Verify every selection exposed by the UI either emits a valid invocation or is explicitly unsupported.

## Required invariants

- Every format has one global profile.
- Endpoint contracts validate against the closed schema, and budget operations declare an explicit missing policy.
- Generated artifacts match their TypeScript sources.
- Every UI-visible selection produces an invocation or is intentionally omitted by the resolved profile.
- Request snapshots win over assistant defaults.
- Queue and steer entries retain their submission-time selection.
- Profile output loses to assistant custom parameters, which lose to call overrides.
- The emission encoder contains no model/provider detection.
- API Gateway and Standard Chat use the same resolver.
- Agent Session rebuilds before applying a changed connection-frozen selection.
