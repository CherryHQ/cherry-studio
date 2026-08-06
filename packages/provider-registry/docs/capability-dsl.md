# Capability DSL design

The registry is not a config file — it is a **small declarative language** whose programs are
provider/model declarations and whose runtime is the request-assembly pipeline. Reasoning controls,
provider-native (server) tools, image generation, and video generation are four *capability
families* written in that language.

This document walks the language **by compiler phase** — lexical, syntax, semantics, types, IR,
target selection, linking, codegen. That ordering is not decoration: each phase has standard
obligations, so a phase with no implementation of one of them is a gap you can find by *omission*
rather than by insight. Every gap found this way is recorded as a numbered finding (`L*` lexical,
`S*` syntax, `M*` semantics, `T*` types, `I*` IR, `G*` target selection, `K*` linking, `C*` codegen)
and collected in [§11](#11-findings-ledger).

- Concrete reasoning semantics: [reasoning-control.md](./reasoning-control.md)
- Pipeline / file layout: [architecture.md](./architecture.md)
- App-side view: [../../../docs/references/provider-model/capability-modeling.md](../../../docs/references/provider-model/capability-modeling.md)

## The one invariant

> **What the UI may offer and what the request can encode must be computed by the same function
> from the same resolved context.**

Every capability family has a vocabulary (effort tiers, image params, tools) that the renderer shows
and the wire encodes. Computed by two functions from two inputs, they drift silently and the user
gets an option that produces HTTP 400 — this was
[#17900](https://github.com/CherryHQ/cherry-studio/issues/17900). Every phase below is judged
against this.

## 1. Phase map

| Phase | Our implementation | Artifact | What checks it today |
| --- | --- | --- | --- |
| **Lexical** — classify model ids into tags | `idPrefixes`, `VENDOR_PATTERNS`, `reasoningFamilies`, `modelRouting.pattern`, `normalizeModelId` | `*.gen.ts` tables + runtime regex | nothing systematic |
| **Syntax** — what a declaration may say | `defineCreator` / `defineProvider`, zod schemas | `src/creators/*`, `src/providers/*` | `tsc` + zod |
| **Semantics** — what it denotes | layered merge, `resolveModelEndpoint`, capability intersection, defaults | runtime `Model` / `Provider` | unit tests |
| **Types** — which values are legal where | `REASONING_WIRE_TARGETS`, `CANONICAL_PARAM_KEY`, effort ladders, `effortMap` | — | partial (`canExpressOff`) |
| **IR** — the compiled program | `data/*.json` | 3 JSON files | zod + catalog invariants + source-sync |
| **Target selection** — which back-end | `resolveAiSdkProviderId`, `resolveProviderVariant`, the config builders, `imageTransportRegistry` | an `AppProviderId` + a model class | nothing systematic |
| **Linking** — bind to the SDK, fix the ABI | `createXxx(settings)` in the config builders | model instance + `optionsKey` | nothing |
| **Codegen** — emit the call | `encodeReasoningInvocation`, image param canonicalizer, tool factories | provider options / request body | boundary tests |
| **Target machine** | **AI SDK**, which then targets the vendor HTTP API | — | **unverifiable by construction** |

The reasoning wire profile is the clearest instance of a real back-end: `ReasoningWireOperation[]`
is a **bytecode**. `target` is an address from a closed set (`REASONING_WIRE_TARGETS`) and
`value.source` is the addressing mode — `literal` (immediate), `effort` (read the selection),
`budget` (computed), `assistant-summary` (read the environment).

**The AI SDK is our assembler, not our machine.** Lowering happens twice — our IR → the SDK's call
shape (`args` + `providerOptions`) → the vendor's HTTP body — and we only own the first. That split
is why the last three phases have to be named separately (§7–§9): target selection picks the
assembler dialect, linking fixes the calling convention, and only then does codegen emit. Collapsing
them into one "codegen" step is what left the SDK adaptation without a home in this analysis.

## 2. Lexical — classifying model ids

**What the phase is.** Mapping tokens from an **open alphabet** (model ids, which vendors mint at
will) onto a finite tag set: which creator owns it, which vendor family it is, which backend serves
it, which capability profile it gets. That is a *scanner*: patterns → token classes, plus a
disambiguation rule.

**Current state.** Eleven matching sites, three encodings, four input conventions, two match times:

| Site | Encoding | Input it matches against | Time |
| --- | --- | --- | --- |
| `Creator.idPrefixes` / `families` | prefix / exact | canonical id | generate |
| `Creator.serverTools`, `serverToolFunctionMixing` | prefix | canonical id | generate → materialized to exact ids |
| `webSearchUnsupportedEfforts` | regex | canonical id | generate → materialized |
| `Creator.reasoningFamilies` | regex | `baseName()` (lowercased, namespace-stripped) | generate **and** runtime |
| `VENDOR_PATTERNS` | regex | documented as "already lowercased + namespace-stripped" | runtime |
| `ProviderModelRoute.pattern` / `exclude` | regex | **raw `apiModelId`** (only an `i` flag) | runtime |
| `isServerToolModelEligible` | set membership | `normalizeModelId` tried twice (with/without parameter size) | runtime |
| provider override lookup | exact | canonical id | link |

**Findings.**

- **L1 — four normalization conventions.** The same id is cut four different ways before matching.
  A scanner has exactly one input form. This silently changes what every rule matches.
- **L2 — prefix and regex are the same relation, undesugared.** `prefix p` ≡ `^p`. Two surface
  forms with one denotation, no normalization pass. Prefixes are worth keeping as a **restricted
  subset** — they give O(len) longest-match via a trie, trivial overlap detection (one is a prefix
  of the other), and a disambiguation rule that does not depend on declaration order. Regex should
  be the escape hatch for genuinely non-prefix naming (`\bgpt\b`, `-maas$`, `^o[134]`).
- **L3 — rule order is load-bearing but undeclared.** `modelRouting` is first-match-wins, stated
  only in a comment. With regexes there is no canonical priority, so order *is* semantics.
- **L4 — no overlap checking, although it is decidable.** Emptiness of the intersection of two
  regular languages is decidable; for the prefix subset it is trivial. Even the cheap approximation
  — "no two rules of one family tag the same *known* id differently", checked against the catalog
  corpus at generate time — does not exist.
- **L5 — no error token.** An id that matches nothing gets a different fallback per feature:
  creator claim drops it (37 unassigned models today), routing falls through to the passthrough
  line, reasoning yields no controls. A scanner has one unknown-token policy.
- **L6 — closed vs open world is decided ad hoc.** Where the id set is known at generate time
  (catalog models), a pattern is a *compile-time query* and should be materialized — server tools
  do exactly this. Where ids appear at runtime (gateway `/models`, user-added), the pattern must
  survive into the runtime. This distinction is real and essential, but it is currently rediscovered
  per feature instead of declared per rule.

## 3. Syntax — the surface language

**What the phase is.** What a declaration is allowed to *say*, and whether ill-formed programs are
rejected before meaning is assigned. Our parser is `tsc`; our grammar is the zod schemas.

**Findings.**

- **S1 — the surface language and the IR share one schema.** `ProviderConfigSchema` types both what
  an author writes and what ships in `providers.json`. There is no separate surface AST and core
  IR, so **desugaring has nowhere to live** — which is why the two-surface-forms problem (S2) can
  only be *rejected*, never *normalized*.
- **S2 — two surface forms for one meaning.** `{ kind: 'toggle' }` and `none ∈ effort.values` both
  denote "reasoning can be disabled". Downstream passes therefore pick nondeterministically, which
  is how a wire chose the wrong off-switch. CI now rejects declaring both — the desugaring answer
  (normalize to a core form) is unavailable because of S1.
- **S3 — context-sensitive well-formedness is unchecked.** `modelRouting.endpointType` must be a
  key of that provider's `endpointConfigs`; a legal-but-undeclared endpoint parses fine and then
  silently falls back at runtime. zod expresses the context-free part; this constraint needs a
  semantic pass.
- **S4 — abstraction exists in one layer only.** The wire layer has combinators (`modeWire`,
  `genericEffort`, `anthropicEnabledBudget`); the routing layer has none, so `^claude` is written
  once per provider fronting Anthropic (4 today). Any repeated shape in a declaration is a missing
  combinator.

## 4. Semantics — what a declaration denotes

### 4.1 Name resolution: the four scopes

A runtime model is resolved through four layers — preset → provider override → endpoint contract →
user row — which is ordinary scope resolution with shadowing. The problem is that **each field
shadows differently**:

| Field | Shadowing rule |
| --- | --- |
| `capabilities` | add / remove / force (`applyCapabilityOverride`) |
| `limits.*` | field-wise, non-null wins |
| modalities, `endpointTypes` | replace if the array is non-empty |
| `pricing`, `parameterSupport` | shallow spread |
| `imageGeneration` | replace **wholesale** (documented, deliberate) |
| `reasoning` support | field-wise `override ?? preset` (`mergeReasoningSupport`) |
| `reasoningContracts[].support.controls` | **replaces** the model's controls |

- **M1 — six shadowing rules among sibling fields of one override object.** Each is defensible in
  isolation; together they are unlearnable. An author cannot predict what a partial override does
  without reading the merge function. The fix is not "make them all the same" — it is to *declare*
  the rule per field in the schema so it is visible at the declaration site.

### 4.2 Endpoint resolution: one chain

"Which endpoint does this (provider, model) use" has exactly one implementation —
`resolveModelEndpoint` (`src/utils/modelRouting.ts`): **model's own declaration → per-model route →
provider default**. Request routing, the catalog's reasoning projection, and the catalog guard test
all go through it.

- **M2 — phase-order violations: branching on the model id after resolution.** A
  `startsWith('claude')` inside a config builder re-runs the lexical phase after name resolution,
  and is invisible to every other consumer. Three such branches were removed (Vertex, Azure, the two
  gateway family tables); **one remains** — `isVertexMaasModelId`, plus its downstream patch in
  `buildAgentParams` that rewrites the reasoning endpoint because the resolved one is wrong for
  MaaS. That patch is the phase violation made visible.

### 4.3 Two-sided capabilities

Some capabilities require agreement from both sides: the provider must serve it, the model must
support it. Each side declares its own half and the runtime intersects; neither restates the other.
Server tools are the reference implementation ([§10.2](#102-server-tools)).

### 4.4 Defaults: the denotation of the unwritten program

- **M3 — an unsound default.** `genericEffort()` is the typing environment for any endpoint with no
  declared wire, and it asserts `off → reasoning_effort: 'none'` for *every* model. True for OpenAI
  GPT-5.1+, DeepSeek's Responses API and DashScope; false for Anthropic, GLM, Kimi and DeepSeek's
  chat API. A default must be **partial** (no `off` unless declared) or **guarded** (`off` only when
  the ladder contains `none`). We approximate the guarded form at runtime (`canExpressOff`) because
  the wire DSL cannot express a guarded rule — an expressiveness gap patched in the interpreter.
- **M4 — inference competing with declaration.** `inferReasoningControls` derives capability from id
  patterns, i.e. the lexical phase producing a type. Legitimate for open-world ids, but it must be
  marked as inference and must never outrank a declaration. The code already enforces this by
  convention ("ingest-time only — never a runtime capability source"); the IR does not record which
  facts came from inference ([I2](#6-ir--the-compiled-program)).

## 5. Types — sorts, domains, coercions

**What the phase is.** Which values are legal in which position. This is where #17900 actually
lived, and where the phase walk finds the most.

**Sorts.** A wire target's *address* is typed (closed enum); its *value* is `string | number |
boolean` — untyped. Nothing states that `thinking.type` takes a vendor keyword, `thinkingBudget` an
integer, and `reasoningEffort` an **effort tier from that endpoint's ladder**.

- **T1 — values have no sorts.** `#17900` was a confusion between two sorts sharing a
  representation: `none` is a canonical marker ("can be disabled") in model data, written by the
  generic wire as a vendor effort value. Rule: *a literal written into an effort-sorted target must
  be a member of that endpoint's declared ladder.* `canExpressOff` enforces this for `none` only.
- **T2 — coercions are unchecked.** `effortMap` is a coercion table (canonical selection → vendor
  value) with **no constraint that its codomain lies inside the ladder**. Scanning the shipped
  catalog finds **7 violations**, e.g.:

  ```
  doubao / doubao-seed-1-6 : ladder = {none, auto, high},  auto → 'medium'
  doubao / deepseek-v4-flash: ladder = {low, high, xhigh, max}, auto → 'medium'
  moonshot / kimi-k3       : ladder = {low, high, max},    auto → 'medium'
  ```

  The first is reachable from the UI: `auto` is in the declared ladder, so the renderer offers it,
  and selecting it emits `reasoning_effort: 'medium'` — a tier the model never declared. Same class
  as #17900, reached through the coercion table instead of the off mode, and **not covered by
  `canExpressOff`**. Either those ladders are under-declared or those maps are wrong; the type
  system should have made the question impossible to leave open.
- **T3 — domains are per-endpoint, but the ladder is often model-level.** The same model has
  different legal tiers on chat vs Responses (DeepSeek V4). Contracts can now carry a per-endpoint
  `support`, but nothing *requires* one when the model-level ladder is known to differ.

**Where the type system already works.** Image generation gets this right: each param carries a
spec (`range` / `enum` / `switch` / `text`) with `default`, `options`, `render` — values with sorts
and domains, drawn from the closed `CANONICAL_PARAM_KEY` vocabulary. That is the model the other
families should converge on.

## 6. IR — the compiled program

`data/*.json`, validated by zod at load. Guarded in both directions: `catalog-hand-edit-check` (data
without source) and `catalog-source-sync` (source without regenerate).

- **I1 — the IR carries redundant folds (kept consistent, not drifting).** `supportedEfforts` /
  `thinkingTokenLimits` / `defaultEffort` are folds of `controls`, shipped alongside it. A catalog
  invariant re-derives them from `controls` and diffs field-by-field against the shipped values on
  every CI run (`reasoningControls.test.ts`, `describe('catalog invariant: controls ↔ derived legacy
  fields')`), so the two representations cannot silently drift. The residual smell is asymmetric
  readership — the runtime effort path treats `controls` as authoritative and the fold as a fallback,
  while `defaultEffort` / `thinkingTokenLimits` are read only as folds — i.e. a second representation
  to keep in sync, not a canonical-form violation.
- **I2 — no provenance.** Axiom (vendor doc), inference (id heuristic), and fold (computed) are
  indistinguishable in the IR. Without that marking, "declare once, derive the rest" is
  unenforceable and M4 has no mechanical guard.
- **I3 — derived values persisted downstream.** `selectableEfforts` is projected into the SQLite
  model row *and* recomputed per request. A stored theorem is a second answer that can disagree with
  the first — the direct cause of #17900's UI/wire split.

## 7. Target selection — which back-end

**What the phase is.** Choosing the concrete machine to emit for. Three orthogonal axes decide it:

| Axis | Decides | Where it lives |
| --- | --- | --- |
| **A1 adapter family** | which npm package / factory | `endpointConfigs[ep].adapterFamily` |
| **A2 endpoint type** | which wire protocol | `endpointType` (resolved in §4.2) |
| **A3 model kind** | language / image / embedding / rerank | **implicit** |

`(A1, A2, A3) → concrete class` is a total function over three closed enums, so it *should* be
exhaustiveness-checkable. It is not, because of how the axes are stored.

- **G1 — `AppProviderId` is a flattened product of (family × endpoint variant).** `openai-chat`,
  `azure-responses`, `xai-responses`, `cherryin-chat`, `google-vertex-anthropic` are all
  (A1, A2) pairs squeezed into one string enum. Consequences follow mechanically: variants must be
  enumerated by hand (`variants: [{ suffix: 'responses' }, …]`), navigation is string concatenation
  (`resolveProviderVariant` builds `` `${base}-${suffix}` ``), and anything downstream that needs one
  axis back has to *reverse* the flattening — which is what makes `resolveProviderOptionsKey` a
  switch that only ever grows.
- **G2 — A3 is not in the enum at all.** Image models therefore take a parallel path
  (`imageTransportRegistry` + a job handler) instead of being another cell in the same table. Every
  bug in [#17394](https://github.com/CherryHQ/cherry-studio/pull/17394) lives on that parallel path.

**Rule B — target selection must complete before codegen begins.** A codegen-time branch on the
model id is target selection happening too late, invisible to every other consumer. `M2`'s remaining
instance (`isVertexMaasModelId`, plus the `buildAgentParams` patch that rewrites the reasoning
endpoint because the resolved one is wrong for MaaS) is exactly this: the patch is the late
selection made visible.

## 8. Linking — binding to the SDK and fixing the ABI

**What the phase is.** Constructing the SDK model instance and, with it, fixing the **calling
convention**. `providerOptions[ns]` is not a parameter bag we name freely — `ns` is the register the
callee reads its arguments from.

Three facts about the AI SDK decide everything here (verified against the installed packages):

1. **Vendor packages hardcode their namespace.** `@ai-sdk/openai` → `"openai"` (`dist/index.mjs:673`,
   shared by chat *and* responses), `@ai-sdk/anthropic` → `"anthropic"`, `@ai-sdk/google` →
   `"google"`. For these the namespace is a **package constant**; we can only mirror it.
2. **`@ai-sdk/openai-compatible` derives it from what we pass.**
   `providerOptionsName = config.provider.split('.')[0]`
   (`@ai-sdk/openai-compatible/dist/index.mjs:423`), and `buildOpenAICompatibleConfig` sets
   `providerSettings.name = provider.id`. So this namespace is **not a lookup — it is the value we
   just wrote at construction time**. (It also tolerates the camelCase spelling: the model reads
   both `providerOptions[name]` and `providerOptions[toCamelCase(name)]`, `dist/index.mjs:533`.)
3. **The endpoint is a class choice, not a parameter.** `.chat(id)` vs `.responses(id)` vs
   `.languageModel(id)` vs `.imageModel(id)` — §7's A2 axis materialises here.

**Rule A — ABI facts flow one way: linker → codegen.** Whatever is fixed at construction
(namespace, instance name, baseURL, headers, fetch) must be *carried* to codegen, never re-derived
there.

- **K1 — the ABI is reverse-derived in codegen.** `resolveProviderOptionsKey` reconstructs the
  namespace from the flattened id (G1) instead of reading it off the link. For vendor packages a
  constant table is legitimate (it mirrors fact 1); for the openai-compatible family it is a
  **guess at a value we already hold**. That guess is the cause of
  [#17394](https://github.com/CherryHQ/cherry-studio/issues/17394): the bag was delivered under
  `providerOptions['openai-compatible']` (the adapter family) while the model read
  `providerOptions[zhipu|tokenhub]` (the concrete id), so it was dropped silently — the UI showed
  controls the wire never received. The fix, in phase terms, is to make `optionsKey` an output of
  linking: `VENDOR_NAMESPACE[family] ?? settings.name`.
- **K2 — the escape hatch is ungoverned.** Parameters reach the request through four channels, and
  they are not peers:

  | Channel | Nature |
  | --- | --- |
  | standard args (`temperature`, `maxOutputTokens`, …) | first-class ABI arguments |
  | `providerOptions[ns]` | the vendor argument region of the ABI |
  | body injection (`createCustomParamsFetch`) | **escape hatch** — the assembler cannot express it, so we patch its output after the fact |
  | headers | out-of-band; not part of the calling convention |

  Today all four are decided across `mergeCustomProviderParameters` / `selectCustomBodyParameters` /
  `normalizeOpenAICompatibleParams` and the per-provider builders, so "which channel does this
  parameter take" has no single answer. The third is inline assembly and must be marked as such,
  with a stated rule for when it is permitted — not treated as a normal channel.
- **K3 — long-running media bypasses the assembler entirely.** `ImageModelV3` upstream exposes only
  `doGenerate`, so submit-then-poll image models (PPIO, DashScope) cannot be expressed
  as SDK models at all; we run them on our own transports (`imageTransportRegistry`) plus a job
  handler. That is target selection stepping *outside* the assembler — and when a provider declares a
  transport that path never wires up, its `vendorTransport` goes unread (TokenHub `hy-image-*`, C5). Upstream is closing this — [vercel/ai#12381](https://github.com/vercel/ai/issues/12381) is
  the umbrella and [vercel/ai#12515](https://github.com/vercel/ai/pull/12515) landed
  `doStart`/`doStatus` for **video** — but images have no async spec yet. Tracked for us in
  [#17952](https://github.com/CherryHQ/cherry-studio/issues/17952); this is an `ai@7` concern and does
  not affect the binding work above.

## 9. Codegen — emitting the call

- **C1 — only one family has a real back-end.** Reasoning has an ISA (targets × addressing modes)
  and a generic interpreter. Image generation canonicalizes params through hand-written per-vendor
  emitters; server tools are injected by hand-written factories. Two of four families are
  hand-coded codegen, so their "instruction set" is implicit.
- **C2 — no validation pass on the emitted body.** Nothing checks that a mode's operations are
  mutually consistent for the target (e.g. emitting an enabled-thinking flag together with a budget
  the vendor rejects). Correctness rests on how each profile was written by hand.
- **C3 — the target is unverifiable, so the surface must be minimized.** No pass can prove a program
  correct against a vendor API. The only defenses are boundary tests against recorded request shapes
  and production errors. This is *why* R2-style discipline matters: every value that cannot be
  checked must be declared exactly once, next to its evidence.
- **C4 — the catalog-wide guard is the closest thing to an assembler test.**
  `reasoningOffWire.catalog.test.ts` walks the whole catalog through the *real* resolvers and
  encoders and asserts no combination emits a literal outside its ladder. It should be generalized
  from the off mode to all modes — which is exactly the T1/T2 rule stated as a test.
- **C5 — no back-end coverage check.** A declaration can be *inert*: TokenHub's `hy-image-*` models
  declared `vendorTransport` endpoints in the registry that no transport read, so requests went to
  the generic `/v1/images/generations` and nothing failed
  ([#17394](https://github.com/CherryHQ/cherry-studio/pull/17394)). In back-end terms this is
  emitting an instruction the selected target has no encoding for — a real back-end raises
  "unsupported instruction for target". Reasoning is immune by construction because its back-end is
  *generic* (any declared address is written by the same encoder); the hand-written back-ends of C1
  are not.

### Case study: PR #17394, three bugs, three phases

Worth keeping because it shows the phases are not academic — one PR hit three of them at once:

| Symptom | Phase that failed |
| --- | --- |
| Registry image params rendered in the UI but never reached the body (`providerOptions['openai-compatible']` vs the concrete id the model reads) | **Linking** — ABI reverse-derived in codegen (K1) |
| Delivered params used canonical camelCase (`addWatermark`, `imageResolution`) instead of the vendor spelling | **Codegen** — a missing lowering pass on one passthrough path (C1); the canonical→wire rename exists but was not applied |
| Declared `vendorTransport` endpoints unread; requests hit the generic endpoint | **Codegen** — inert instruction, no coverage check (C5) |

All three follow from image generation having hand-written per-vendor back-ends rather than a
declarative one. With a generic back-end the delivery key is part of the single link, the rename is
part of the instruction, and an unimplemented target is a schema error rather than silence.

## 10. The four capability families

### 10.1 Reasoning

Controls (`effort` / `budget` / `toggle`) in `models.json`; per-endpoint deviation in
`reasoningContracts[endpoint].support`; wire encoding from contract → provider `reasoningFormat` →
`REASONING_FORMAT_PROFILES[format]`, with `wireDialect` selecting a variant. The most fully
specified family and the one with the most type-level debt (T1, T2, T3, M3, S2, I1).

### 10.2 Server tools

Introduced in its current form by
[#17322](https://github.com/CherryHQ/cherry-studio/pull/17322), which moved the provider half out of
creator data.

- **Provider half** (`serverTools[]`): `{ id, modelScope, vendors? }`. `modelScope:
  'all-chat-models'` means the host serves it for everything it fronts; `'model-dependent'` means
  model eligibility must also pass. `vendors` narrows to vendor families when the host's SDK is
  narrower (Vertex `url-context` is Gemini-only — the vertex-anthropic SDK exposes no webFetch).
- **Model half** (creator `serverTools: Partial<Record<ServerTool, string[]>>`): id-prefixes,
  compiled to an exact-id table (`patterns/server-tool-models.gen.ts`), read via
  `isServerToolModelEligible`.
- **Constraints** compiled the same way: `serverToolFunctionMixing` → `server-tool-constraints.gen.ts`;
  `webSearchUnsupportedEfforts` → effort tiers the native tool rejects.

The reference implementation for §4.3 and for L6: both halves are closed vocabularies, and the
prefix declaration is materialized at generate time so no regex survives into the runtime.
Eligibility is deliberately *not* a generic model capability — that would create a second source of
truth. Remaining weakness: prefix overlap between creators is unchecked (L4).

### 10.3 Image generation

`imageGeneration.modes[mode]` over a closed mode set (`generate | edit | remix | upscale | merge`),
partial record. `supports` is a partial record over `CANONICAL_PARAM_KEY` — one closed vocabulary
that is simultaneously the registry key, the form's label key, and the runtime `painting.params`
key (camelCase on purpose: these *are* the param names). Each param carries a typed spec.

Ownership split: the **creator** declares `supports` (provider-agnostic), the **provider** declares
`vendorTransport { endpoint, isSync }`. The runtime replaces the block wholesale rather than
deep-merging, so a provider needing custom transport restates the full block — deliberate, see
[architecture.md](./architecture.md#image-generation-design-b).

The reference implementation for the type phase (§5).

### 10.4 Video generation — not modeled yet

Only three things exist: the `video-generation` capability, the `video` output modality, and the
`openai-video-generation` endpoint type. There is **no** `videoGeneration` support block, so params,
modes, and transport live in feature code — the hardest violation of I2/C3 (axioms outside the
catalog).

The shape follows from the phases:

```ts
videoGeneration: {
  modes: {                                   // closed set: generate | image-to-video | extend
    generate: {
      supports: {                            // partial record over CANONICAL_VIDEO_PARAM_KEY
        duration:    { type: 'range', min: 2, max: 10, default: 5 },
        resolution:  { type: 'enum', options: ['720p', '1080p'], render: 'chips' },
        aspectRatio: { type: 'enum', options: ['16:9', '9:16'] },
        seed:        { type: 'text' }
      },
      maxInputImages: 1,                     // image-to-video reference frames
      vendorTransport: { endpoint: '…', isSync: false }   // video is async by default
    }
  }
}
```

Decisions to make deliberately rather than by accident:

1. **A new closed vocabulary, not a reuse of `CANONICAL_PARAM_KEY`.** Image and video share names
   (`seed`, `aspectRatio`) but not domains; one enum with two domains breaks T1 and makes the image
   form's label table wrong for video.
2. **Async is the norm.** `vendorTransport.isSync` exists for images because a few vendors are
   synchronous; for video the job/polling shape is the default, with sync as the exception.
3. **Duration drives price.** `ModelPricing.perMinute` is the tier video actually uses, and the
   param that determines cost (`duration`) sits in the same block — keep them adjacent so the cost
   engine reads one source.
4. **Modes are closed** and decided up front, with a partial record so single-mode models stay
   honest.

## 11. Findings ledger

Ordered by leverage, not effort. Phase tags link back to the analysis.

| # | Finding | Phase | Leverage |
| --- | --- | --- | --- |
| T2 | `effortMap` codomain unchecked — **7 live violations**, at least one UI-reachable | Types | Ship a check; it is the same bug class as #17900 |
| K1 | ABI reverse-derived in codegen instead of carried from the link | Linking | Fixes the #17394 class at the root; same PR as C1/C5 |
| T1 | Values have no sorts/domains; `canExpressOff` is the special case | Types | Generalize to all modes → structural UI/wire agreement (see C4) |
| M2 | One id branch still bypasses the resolver (Vertex MaaS + its downstream patch) | Semantics | Removes the last phase-order violation |
| L1 | Four normalization conventions before matching | Lexical | Small change, affects every match |
| I1 | Redundant folded fields, kept consistent by an existing catalog invariant | IR | Low — a second representation to keep in sync, not a drift risk |
| C5 | No back-end coverage check — declarations can be inert | Codegen | One assertion; caught a shipped bug (#17394) |
| L2/L4 | prefix ≡ regex undesugared; no overlap check although decidable | Lexical | Restores exhaustiveness/disjointness reasoning |
| M1 | Six shadowing rules among sibling override fields | Semantics | Declare per field in the schema |
| S3 | `modelRouting.endpointType ⊆ endpointConfigs` unchecked | Syntax | One schema refine |
| K2 | Four parameter channels, no rule for which one a param takes; the escape hatch is unmarked | Linking | Prerequisite for any generic back-end |
| I3 | Derived vocabulary persisted on the row | IR | Largest blast radius (renderer reads it) |
| M3 | Unsound generic `off` default | Semantics | Needs guarded rules in the wire DSL |
| G1/G2 | `AppProviderId` flattens (family × endpoint); model kind absent from the axes | Target selection | Restores exhaustiveness; unblocks folding image into one table |
| S4/L5/L6 | No routing combinators; no error token; world not declared | Syntax/Lexical | Cleanup once the above land |
| C1/C2 | Only reasoning has a declarative back-end; no emitted-body validation | Codegen | Large; do after types |
| K3 | Long-running media bypasses the assembler ([#17952](https://github.com/CherryHQ/cherry-studio/issues/17952)) | Linking | Blocked on `ai@7` + upstream image async spec |
| 10.4 | Video generation unmodeled | All | Largest missing surface |

## 12. Adding a new capability family

Answer in phase order; each question is the phase's obligation.

1. **Lexical** — does classifying a model for this capability need patterns? If the id set is known
   at generate time, materialize to exact ids and keep regex out of the runtime (L6).
2. **Syntax** — what may an author write? Define the closed vocabulary (modes, param keys, tool ids)
   *before* the first declaration, and give repeated shapes a combinator (S4).
3. **Semantics** — is it two-sided (provider serves × model supports)? Then two halves intersected
   at runtime, neither restating the other (§4.3). Declare the shadowing rule for every field you
   add (M1).
4. **Types** — do values need domains? Give them specs, not bare strings (T1). If a coercion table
   exists, state and check its codomain (T2).
5. **Defaults** — the denotation of "nothing declared" must be *unsupported*, never a guessed
   encoding (M3).
6. **IR** — what is axiom, what is derived? Ship axioms; compute theorems; if you must fold, add the
   verifying invariant (I1, I2).
7. **Target selection** — which (adapter family, endpoint, model kind) cell does this capability
   occupy? If the answer is "none — it needs its own path", say so explicitly and expect C5's class
   of bug until the path is covered by an assertion (G2, K3).
8. **Linking** — what does the SDK fix at construction time (namespace, instance name, transport)?
   Carry those values forward; never re-derive them downstream (Rule A, K1). State which of the four
   channels each parameter takes, and whether any needs the escape hatch (K2).
9. **Codegen** — which single function turns declarations into the request, and which single
   function derives what the UI may offer? They must share their input — this is the invariant at
   the top of this document.
