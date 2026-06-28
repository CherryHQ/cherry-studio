# Image-Generation Parameterized Architecture

How the paintings page renders a per-model parameter form, collects the user's
values, and turns them into a vendor-correct image-generation request — **all
driven by registry + catalog data, with zero per-vendor UI code and the
canonical→wire rename declared exactly once**.

The goal: adding a new image model (or a whole new vendor) should be a **data**
change. A new param that several models share is a one-row catalog addition that
flows to the form, the validation, the wire body, and the static types at once.
Vendor wire-format quirks live in exactly one declarative place each.

---

## The data chain at a glance

One canonical param set (`paramValues`) is the trunk. It forks into two delivery
adapters only at the very end — the wire request is the same, only the way it's
shipped differs.

```
┌─ RENDERER ────────────────────────────────────────────────────────────────────┐
│ registry per-model `supports`  ──useImageGenerationSupport──▶ form              │
│    imageGenerationToFields: SupportSpec.type → control (one map)                │
│        user edits → painting.params  (canonical camelCase bag)                  │
│    canonicalGenerate: buildParamsSchema(support,mode) validate / coerce         │
│        → paramValues  (pure canonical bag; blanks dropped, customSize composed) │
└──────────────────────────── ipcApi.request('ai.generate_image') ───────────────┘
                                       │  { uniqueModelId, prompt, mode, paramValues, inputImages?, mask? }
                                       ▼   (IPC schema is loose: the model is dynamic)
┌─ MAIN · AiService.generateImage ───────────────────────────────────────────────┐
│   splitParamValues(paramValues)  ──via AI_SDK_NATIVE_BINDINGS──▶                │
│        structured = { n, size, seed, aspectRatio, … }   (typed ParamValues & {n})│
│        vendorBag  = { the non-native canonical params, camelCase }              │
│                                                                                 │
│   resolveImageTransport(provider, model)?                                       │
│     ├─ NO  → SDK delivery                  ├─ YES → transport delivery           │
│     ▼                                       ▼                                    │
│   buildVendorProviderOptions               getImageGenerationSupport(provider,   │
│     (WireProfile + wireName)                 model).modes[mode].vendorTransport  │
│     → providerOptions[id] = WIRE body        → modelDescriptor (typed routing)   │
│     native → imageParams (n/size/seed)      generateImageViaJob(structured,      │
│                                               vendorBag, modelDescriptor)        │
└────────┼────────────────────────────────────────────┼──────────────────────────┘
         ▼                                              ▼ JobManager → imageGenerationJobHandler
   AI SDK image model                             transport.submit(input)
   (SiliconImageModel / @ai-sdk/openai-compatible  reads canonical camelCase params
    / @ai-sdk/google / aihubmix custom)             + input.{n,size,seed} + input.modelDescriptor
   spreads providerOptions[id] → HTTP body          builds its own envelope (input.* /
                                                     parameters.* / messages[]), POST, poll
         │                                              │
         ▼ parse response                               ▼ poll → parse response
       image data URLs ◀────────────── back through IPC ──────────▶ renderer
```

Two halves, one canonical vocabulary in the middle:

- **Read half** — registry `supports` ⊗ catalog → form fields → `painting.params`.
- **Write half** — `paramValues` → `splitParamValues` → the WireProfile engine /
  the transport → vendor wire body.

The contract between them is the **catalog** (the canonical key set + each key's
value type, control, and wire name). The form, the validation, the partition, and
the static types all project from it.

---

## The single sources — each fact declared once

| Fact | Declared in | Consumed by |
| --- | --- | --- |
| param value type + control + wire name | `IMAGE_PARAM_CATALOG` (`ParamValues`, `wireName`) | form, validation, wire engine, `structured` type |
| per-model: which params + constraints (options/range/default) | registry `supports` | form + `buildParamsSchema` |
| canonical → AI-SDK-native (`numImages→n`, `aspectRatio` normalize, …) | `AI_SDK_NATIVE_BINDINGS` | `splitParamValues` |
| canonical → vendor wire name (`negativePrompt→negative_prompt`) | `wireName()` (catalog `wire` or auto snake_case) | WireProfiles + aihubmix DEFAULT |
| per-provider delivery (dual-key / passthrough / sibling key / envelope) | `WIRE_REGISTRY` + each transport | the two adapters |
| per-model endpoint routing (endpoint / sync / response family) | registry `vendorTransport` → `modelDescriptor` | the transports |

Nothing in this list is repeated. A canonical param is **one** catalog row; a
provider's wire shape is **one** profile / transport.

---

## Layer 1 — the param catalog (the atom)

Source of truth: [`packages/provider-registry/src/schemas/imageParamCatalog.ts`](../../../packages/provider-registry/src/schemas/imageParamCatalog.ts).

Each `CanonicalParamKey` is declared **once**, with everything the pipeline needs
to project from:

```ts
interface ImageParamCatalogEntry {
  schema: z.ZodTypeAny   // SINGLE source of the value type → form validation + ParamValues type
  control: ParamControlKind // enum | range | switch | text | seedInput | size
  wire?: string          // vendor wire name override; omit for the auto camelCase→snake_case form
}

const IMAGE_PARAM_CATALOG = {
  negativePrompt:    { schema: optString, control: 'text' },               // → 'negative_prompt' (auto)
  numInferenceSteps: { schema: optInt,    control: 'range' },              // → 'num_inference_steps' (auto)
  imageResolution:   { schema: optString, control: 'enum',  wire: 'size' }, // irregular → explicit
  addWatermark:      { schema: optBool,   control: 'switch', wire: 'watermark' },
  // … exhaustive over CanonicalParamKey (a missing/extra key is a compile error)
} as const satisfies Record<CanonicalParamKey, ImageParamCatalogEntry>

type ParamValues = { [K in CanonicalParamKey]?: ParamValue<K> } // z.infer of each schema
```

Three projections fall out of the atom, so they can never drift:

- **`buildParamsSchema(support, mode)`** ([`.../utils/buildParamsSchema.ts`](../../../packages/provider-registry/src/utils/buildParamsSchema.ts)) — catalog value schemas ⊗ the per-model `supports` constraints (enum members / range bounds) → the zod schema that validates a model's form bag. `.loose()` during migration.
- **`ParamValues`** — `z.infer` of the catalog. The typed canonical bag; there is no hand-maintained param-shape type.
- **`wireName(key)`** — `catalog.wire ?? autoSnakeCase(key)`. The **single** canonical→wire rename. Every flat-body provider derives its field name from here; no provider repeats `negativePrompt → negative_prompt`.

> Native params (`numImages`/`size`/`seed`/`aspectRatio`) do **not** go through
> `wireName` — they're routed by `AI_SDK_NATIVE_BINDINGS` (app layer, see below),
> because their target is an AI SDK call option, not a body field name.

---

## Registry schema — per-model `supports` + routing

Source: [`packages/provider-registry/src/schemas/model.ts`](../../../packages/provider-registry/src/schemas/model.ts) (`ImageGenerationSupportSchema`).

```ts
interface ImageGenerationSupport {
  modes: Partial<Record<ImageGenerationMode, ModeDef>> // generate | edit | remix | upscale | merge
}

interface ModeDef {
  supports: Partial<Record<CanonicalParamKey, SupportSpec>> // which params + their per-model constraints
  vendorTransport?: { endpoint: string; isSync?: boolean }  // async / non-OpenAI routing
  requirePrompt?: boolean                                   // default true; false for qwen-mt-image, upscalers
}

type SupportSpec =
  | { type: 'switch'; default?: boolean }
  | { type: 'enum';   options: string[]; default?: string; render?: 'select' | 'chips'; columns?: number }
  | { type: 'range';  min: number; max: number; default?: number; step?: number }
  | { type: 'size';   minSide: number; maxSide: number; pairedEnumKey?: string }
  | { type: 'text';   multiline?: boolean }
```

`supports` carries **only** the per-model constraints (which params, their
options/range/default); the value type, control kind, and wire name live in the
catalog. A model's block resolves **override-wins** in
`ProviderRegistryService.getImageGenerationSupport` ([`src/main/data/services/ProviderRegistryService.ts`](../../../src/main/data/services/ProviderRegistryService.ts)):

```
registryOverride.imageGeneration  ??  presetModel.imageGeneration  ??  null   // null → empty form
```

- Base entry → [`packages/provider-registry/data/models.json`](../../../packages/provider-registry/data/models.json) (provider-agnostic official contract).
- Provider override → [`packages/provider-registry/data/provider-models.json`](../../../packages/provider-registry/data/provider-models.json), keyed by `{ providerId, modelId }` (vendor-flavored params / vendor-exclusive SKUs). Id normalization tolerates dotted vs sanitized ids.

---

## Read half — registry + catalog → form

1. **Fetch** — `useImageGenerationSupport(providerId, modelId)` ([`.../hooks/useImageGenerationSupport.ts`](../../../src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts)) queries `GET /providers/:providerId/models/:modelId*/image-generation-support` (DataApi → the same `ProviderRegistryService` main hosts; SWR-cached).
2. **Map** — `imageGenerationToFields(support, { mode })` ([`.../form/imageGenerationToFields.ts`](../../../src/renderer/pages/paintings/form/imageGenerationToFields.ts)) iterates `modes[mode].supports` and dispatches each entry through `specToField` by `spec.type` — no per-vendor branches:

   | `SupportSpec.type` | widget |
   | --- | --- |
   | `switch` | toggle |
   | `enum` (`render:'chips'`) | chip row (size / aspectRatio / imageResolution) |
   | `enum` (default) | select dropdown |
   | `range` | slider |
   | `size` | custom width×height inputs (gated on `pairedEnumKey === 'custom'`) |
   | `text` | input / textarea (`multiline`) |

3. **Label** — `KEY_LABELS` (same file) maps each `CanonicalParamKey` → i18n title/tooltip (exhaustive over the key set).

Form edits write into **`painting.params`** — a flat canonical-keyed bag. Defaults
are committed when the model is selected by `computeModelFieldReset`
([`.../utils/computeModelFieldReset.ts`](../../../src/renderer/pages/paintings/utils/computeModelFieldReset.ts)).

---

## Write half — `paramValues` → vendor request

### 1. Validate + collapse to one IPC bag (`canonicalGenerate`)

[`.../model/canonicalGenerate.ts`](../../../src/renderer/pages/paintings/model/canonicalGenerate.ts) validates `painting.params` through `buildParamsSchema(support, mode)` (soft-fail to raw on a bad value), drops blanks, composes `customSize_*` → `size`, and ships one canonical **`paramValues`** bag over IPC (`ai.generate_image`, [`src/shared/ipc/schemas/ai.ts`](../../../src/shared/ipc/schemas/ai.ts)). The IPC schema is intentionally loose (`z.record(z.string(), z.unknown())`) — the model is dynamic, and the renderer already validated against the catalog.

### 2. Partition in main (`splitParamValues` + `AI_SDK_NATIVE_BINDINGS`)

[`AiService.generateImage`](../../../src/main/ai/AiService.ts) calls `splitParamValues` ([`src/main/ai/utils/imageOptions.ts`](../../../src/main/ai/utils/imageOptions.ts)), which uses `AI_SDK_NATIVE_BINDINGS` ([`src/main/ai/utils/aiSdkNativeBindings.ts`](../../../src/main/ai/utils/aiSdkNativeBindings.ts)) to split the bag:

- **native** (`numImages→n`, `size`, `seed`, `aspectRatio` normalized once) → `structured` (typed `ParamValues & { n?: number }`), the AI SDK call options.
- **everything else** → `vendorBag` (canonical camelCase).

Blank / `null` / `undefined` are dropped here (the byte-identical-wire guard); the
`'auto'` sentinel survives and is resolved to "omit the field" at the wire layer.

### 3. The WireProfile engine (SDK delivery)

For SDK-delivered providers, `buildVendorProviderOptions` ([`src/main/ai/provider/custom/wire/buildImageRequest.ts`](../../../src/main/ai/provider/custom/wire/buildImageRequest.ts)) maps the canonical bag to the wire body via `wireName`, then packages it per the provider's registration in `WIRE_REGISTRY` ([`src/main/ai/provider/custom/wire/wireProfile.ts`](../../../src/main/ai/provider/custom/wire/wireProfile.ts)):

```ts
interface WireProfile  { fields: Partial<Record<CanonicalParamKey, WireRule>> } // forward / map / contribute
interface WireRegistration {
  profile: WireProfile
  dualOpenAI?: boolean   // mirror the clean body under `openai` too (gpt-image family)
  passthrough?: boolean  // forward vendor-bag fields the profile doesn't name (silicon cfg, …)
  also?: { key; profile }[] // a sibling provider key (dmxapi → google.imageConfig)
}
```

A profile declares **which** canonical params ride in the body; the **name**
comes from `wireName`. Delivery (which key(s), passthrough, sibling, nesting) is
the registration's job — not the profile's, and never a repeated rename. Providers
absent from `WIRE_REGISTRY` fall back to `DEFAULT_DIFFUSION_REGISTRATION` (the
OpenAI-compatible diffusion family). The result is `providerOptions[id]`, which
the AI SDK image model spreads into the request body; `structured` becomes the
typed call options (`imageParams`).

The SDK image model is one of: a custom `ImageModelV3` (e.g.
[`silicon/SiliconImageModel.ts`](../../../src/main/ai/provider/custom/silicon/SiliconImageModel.ts), [`aihubmix/aihubmixImageModel.ts`](../../../src/main/ai/provider/custom/aihubmix/aihubmixImageModel.ts)), `@ai-sdk/openai-compatible`, or `@ai-sdk/google`. It **reads** the wire body — it does not re-rename it.

### 4. Transport delivery (async / bespoke wire shape)

When `resolveImageTransport(provider, model, settings)` ([`.../custom/imageTransportRegistry.ts`](../../../src/main/ai/provider/custom/imageTransportRegistry.ts)) returns a transport (DashScope / PPIO / ModelScope / OVMS / DMXAPI-custom families), the request runs on the job system (`generateImageViaJob` → `JobManager` → `imageGenerationJobHandler`) so it survives a restart.

Unlike the SDK path (whose bag IS the body), a transport builds its **own** per-model
envelope, so it receives the **canonical camelCase params directly** — native
`n/size/seed` via the typed `ImageGenerationSubmitInput.{n,size,seed}`, the rest
via `providerParams` (the `vendorBag`). No wire-naming, no casing probes: each
transport reads `params.negativePrompt`, `params.promptExtend`, … and places them
into its structure (`input.*` / `parameters.*` / `messages[]`) with the field name
its API wants. See [`imageGenerationModel.ts`](../../../src/main/ai/provider/custom/imageGenerationModel.ts) for the `ImageGenerationTransport` contract and each `<vendor>/<vendor>Transport.ts`.

### 5. Routing — `modelDescriptor` (derived in main)

A transport routes by `modelDescriptor = { id, endpoint, isSync, mode }` — which
endpoint to POST, whether to poll, and which response-family parser to use.

This is **backend routing data**, derived where routing happens: `AiService`,
holding the resolved `(providerId, modelId, mode)`, calls
`providerRegistryService.getImageGenerationSupport(...)` → `modes[mode].vendorTransport`
and builds the descriptor, threading it as a **typed field** on the job payload /
`ImageGenerationSubmitInput.modelDescriptor` — never through the param bag. The
registry is the source of `vendorTransport`, and main already hosts it (the
renderer's support fetch is an IPC round-trip to the same service), so the
descriptor is a pure derivation, not a param.

> **Status / migration.** The descriptor is currently injected by the renderer
> ([`paintingPipeline.ts`](../../../src/renderer/pages/paintings/model/paintingPipeline.ts) stuffs it into `painting.params.modelDescriptor`), which is why `paramValues` isn't yet a *strict* `ParamValues`. Moving the derivation into `AiService` (add `mode` to the IPC payload — a request property, not a param — and read `vendorTransport` from the registry) is the final step: it removes the only non-canonical key from `paramValues`, lets the bag be parsed to a strict `ParamValues`, and closes the last `Record<string,unknown>` seam. See the [data architecture follow-up](#follow-up--close-the-strict-typing-seam).

---

## Recipes

### Add a parameter to a model

1. Pick (or reuse) the **canonical key**. If new, add one row to `IMAGE_PARAM_CATALOG` (`{ schema, control, wire? }`) — set `wire` **only** if the vendor name isn't the auto snake_case form. Add its `KEY_LABELS` row + i18n (`pnpm i18n:sync`).
2. Declare it in the model's `supports` with the right `SupportSpec` (options/range/default).
3. That's it for a flat-body provider — the form, validation, types, and wire name all flow from the catalog row. Only add a `WireProfile` field / transport line if the param needs bespoke placement (a nested block, a sibling provider key, a transport envelope).

### Add a model

- Provider-agnostic official model → `imageGeneration` block in **`models.json`**.
- Vendor-flavored / exclusive → `{ providerId, modelId, imageGeneration }` override in **`provider-models.json`**.
- Async / non-OpenAI wire shape → add `vendorTransport.endpoint` (+ `isSync`) and ensure the vendor's transport recognizes the model family.

### Add a vendor

- OpenAI-compatible → nothing custom: the `DEFAULT_DIFFUSION_REGISTRATION` engine + `@ai-sdk/openai-compatible` cover it.
- Native SDK (OpenAI/Google) → register a `WireProfile` with the right delivery flags (`dualOpenAI` / `also` / `passthrough`).
- Bespoke / async wire shape → implement an `ImageGenerationTransport`, register it on the provider's `imageModel(...)`, and read canonical camelCase params + `input.modelDescriptor`.

---

## Follow-up — close the strict-typing seam

The param pipeline is fully consolidated (one catalog row → form + validation +
wire + types; one `wireName`; one engine; transports on canonical camelCase). The
**one** remaining seam is routing data laundered through the param bag:

1. Add `mode: ImageGenerationModeSchema` to `aiImagePayloadSchema`.
2. In `AiService.generateImage`, when a transport resolves, derive `modelDescriptor` from `providerRegistryService.getImageGenerationSupport(...)` and pass it as a typed field to `generateImageViaJob` / the transport.
3. Transports read `input.modelDescriptor` (not `bag.modelDescriptor`).
4. Delete the `paintingPipeline.ts` descriptor injection.

Then `paramValues` is pure canonical and can be parsed to a strict `ParamValues`
in main — the last `Record<string,unknown>` in the chain.

---

## Critical files

| Concern | File |
| --- | --- |
| **Param catalog** (value + control + wire) | `packages/provider-registry/src/schemas/imageParamCatalog.ts` |
| Per-model validation schema | `packages/provider-registry/src/utils/buildParamsSchema.ts` |
| Registry schema (`supports` / `vendorTransport`) | `packages/provider-registry/src/schemas/model.ts` |
| Base / override model data | `packages/provider-registry/data/{models,provider-models}.json` |
| Resolver (override ?? base) | `src/main/data/services/ProviderRegistryService.ts` |
| Support fetch hook | `src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts` |
| Registry → form fields + `KEY_LABELS` | `src/renderer/pages/paintings/form/imageGenerationToFields.ts` |
| Default population on switch | `src/renderer/pages/paintings/utils/computeModelFieldReset.ts` |
| Validate + build the IPC `paramValues` bag | `src/renderer/pages/paintings/model/canonicalGenerate.ts` |
| Transport routing hint (→ backend, see §5) | `src/renderer/pages/paintings/model/paintingPipeline.ts` |
| IPC payload schema | `src/shared/ipc/schemas/ai.ts` |
| Main entry + native split + job dispatch | `src/main/ai/AiService.ts` |
| `splitParamValues` (native vs vendorBag) | `src/main/ai/utils/imageOptions.ts` |
| AI-SDK native binding table | `src/main/ai/utils/aiSdkNativeBindings.ts` |
| WireProfile engine + delivery registry | `src/main/ai/provider/custom/wire/{buildImageRequest,wireProfile}.ts` |
| Custom transport contract | `src/main/ai/provider/custom/imageGenerationModel.ts` |
| Vendor provider + transport | `src/main/ai/provider/custom/<vendor>/{<vendor>Provider,<vendor>Transport}.ts` |
| Shared transport helpers | `src/main/ai/provider/custom/transportUtils.ts` |
