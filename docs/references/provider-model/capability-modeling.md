# Capability Modeling

How a model capability — reasoning effort, provider-native tools, image generation, video
generation — travels from a vendor's documentation to a request body, and which layer owns each
fact along the way.

Read this before adding a capability, a provider-specific parameter, or a per-model exception.

- Language design and the rules behind these boundaries:
  [capability DSL design](../../../packages/provider-registry/docs/capability-dsl.md)
- Reasoning semantics in detail:
  [reasoning control](../../../packages/provider-registry/docs/reasoning-control.md)
- How registry data is loaded and merged with user data:
  [provider registry](./provider-registry.md)

## The chain

```
vendor docs                    the only unverifiable input
   │  declared once, as an "axiom"
   ▼
src/creators/*.ts   ← what the MODEL can do (provider-agnostic)
src/providers/*.ts  ← what this HOST serves, and how to reach it
   │  pnpm generate  (claims ids, folds constants, compiles lookup tables)
   ▼
data/*.json         ← the IR, validated by zod at load
   │  RegistryLoader + layered merge: preset → provider override → endpoint contract → user row
   ▼
runtime Model / Provider
   │  one resolver decides the endpoint; everything downstream is a function of it
   ▼
request body        +        what the UI is allowed to offer
        └──── both derived from the same resolved context ────┘
```

The last line is the invariant that matters: **the vocabulary the renderer shows and the parameters
the request emits must come from the same function applied to the same resolved context.** When
they came from two functions, users saw options that produced HTTP 400
([#17900](https://github.com/CherryHQ/cherry-studio/issues/17900)).

## Ownership

| Fact | Owner | Not owned by |
| --- | --- | --- |
| What a model intrinsically supports (effort knobs, image params, modalities) | `src/creators/*.ts` → `models.json` | providers, app code |
| How to reach a host, and which endpoint each model uses | `src/providers/*.ts` → `providers.json` (`endpointConfigs`, `defaultChatEndpoint`, `modelRouting`) | app code, config builders |
| Per-(provider, model) deviation | `provider-models.json` (`endpointTypes`, `reasoningContracts`, `imageGeneration`, pricing) | either side alone |
| Mappings between closed sets (endpoint → wire format, adapter family → SDK class / options namespace) | app code — they are total functions over enums | registry data |
| User choices | SQLite rows | registry |
| Anything derivable from the above | **nobody — it is computed** | any persisted column |

The last row is the one most often broken. A derived value that gets persisted (a projected effort
vocabulary, a folded `supportedEfforts`) becomes a second answer that can disagree with the first.

## The four families today

| Family | Model side | Provider side | Request side |
| --- | --- | --- | --- |
| **Reasoning** | `reasoning.controls` (`effort` / `budget` / `toggle`) | `reasoningFormat.wire` per endpoint; `reasoningContracts[endpoint]` per model | `resolveReasoningInvocation` → provider options |
| **Server tools** (`web-search`, `url-context`) | creator `serverTools` id-prefixes → compiled exact-id table | `serverTools[] { id, modelScope, vendors? }` | eligibility intersection → tool injection |
| **Image generation** | `imageGeneration.modes[mode].supports` over the closed `CANONICAL_PARAM_KEY` vocabulary | `vendorTransport { endpoint, isSync }` | canonical params → vendor body |
| **Video generation** | *not modeled* — only the `video-generation` capability and `video` modality exist | — | params/transport live in feature code |

Server tools are the reference for a **two-sided** capability: the provider declares that it serves
the tool (and for which vendor families), the creator declares which of its models can use it, and
the runtime intersects. Neither side restates the other's half, and eligibility is deliberately not
a generic model capability — that would create a second source of truth.

Image generation is the reference for a **parameterised** capability: one closed vocabulary of
param keys that is simultaneously the registry key, the UI label key, and the runtime param key, and
each param carries a typed spec (range / enum / switch / text) rather than a bare string.

Video generation is the gap: its facts currently live in code rather than the catalog. The shape it
should take is derived in
[capability-dsl.md §10.4](../../../packages/provider-registry/docs/capability-dsl.md#104-video-generation--not-modeled-yet).

Long-running (submit-then-poll) image models sit outside the AI SDK entirely, because its image spec
exposes only a single-shot `doGenerate`. That parallel path — our own transports plus a job handler —
is why a declared `vendorTransport` can go unread. Upstream is adding a start/status flow for video
first; tracked for us in [#17952](https://github.com/CherryHQ/cherry-studio/issues/17952).

## Rules of thumb

1. **Declare the vendor fact once**, next to the evidence (the provider or creator file), and derive
   everything else. If two places state the same thing, one of them will go stale.
2. **Never branch on a model id after the endpoint is resolved.** A `startsWith('claude')` inside a
   config builder is invisible to the catalog projection, so the UI and the wire disagree. Express
   it as `modelRouting` data instead.
3. **Whatever the SDK fixes at construction time, carry it — never re-derive it.** The
   `providerOptions` namespace is the calling convention: vendor packages hardcode it, while the
   openai-compatible family reads back the `name` we passed. Recomputing it downstream is a guess at
   a value we already hold, and a wrong guess drops the whole bag silently.
4. **Absent declaration means unsupported**, never a guessed encoding. A default that asserts a wire
   shape it cannot know is how an unsupported parameter reaches a vendor.
5. **Prefer a closed vocabulary to a regex.** Enums give exhaustiveness and disjointness checks;
   patterns give neither, and rule order silently becomes semantics.
6. **Two surface forms for one meaning is a bug in waiting.** Declaring both a `toggle` and a `none`
   effort tier lets different consumers pick different off-switches; CI now rejects it.
7. **A capability's UI vocabulary is not a stored field.** Derive it per request from the resolved
   endpoint, or the two will drift.

## Where to look

| What | Where |
| --- | --- |
| Capability schemas | `packages/provider-registry/src/schemas/model.ts`, `provider.ts` |
| Closed vocabularies (tools, param keys, endpoints, efforts) | `packages/provider-registry/src/schemas/enums.ts` |
| Endpoint resolution (the single chain) | `packages/provider-registry/src/utils/modelRouting.ts` |
| Wire profiles and their combinators | `packages/provider-registry/src/reasoningProfiles.ts`, `src/providers/wires.ts` |
| Compiled lookup tables | `packages/provider-registry/src/patterns/*.gen.ts` |
| Vocabulary projection (what the UI may offer) | `src/main/data/services/ProviderRegistryService.ts` |
| Wire encoding (what the request emits) | `src/main/ai/utils/reasoningSerializers.ts` |
| Catalog invariants | `packages/provider-registry/src/__tests__/catalog-invariants.test.ts`, `src/main/data/services/__tests__/reasoningOffWire.catalog.test.ts` |
