# Image-Generation Parameterized Architecture

How the paintings page renders a per-model parameter form, collects the user's
values, and turns them into a vendor-correct image-generation request — **all
driven by registry data, with zero per-vendor UI code**.

The goal: adding a new image model (or a whole new vendor) should be a **data**
change in the registry, not a code change. A new param that several models
share is a one-row addition. Vendor wire-format quirks live in exactly one
place each (the AI SDK adapter), never in the form or the page.

---

## The pipeline at a glance

```
registry data ──► DataApi ──► useImageGenerationSupport ──► imageGenerationToFields ──► form widgets
(models.json /                (SWR cache)                    (SupportSpec → BaseConfigItem)   │
 provider-models.json)                                                                        │ user edits
                                                                                              ▼
                                                                                   painting.params (canonical bag)
                                                                                              │
                                                            canonicalGenerate (partition)     │
                                                            ┌─────────────────────────────────┘
                                                            ▼
                              aiSdkParams (native fields)         providerBag (everything else)
                                            │                                   │
                                            └───────────────┬───────────────────┘
                                                            ▼
                                       AiProvider.modernGeneratePaintingImage
                                                            │ buildImageProviderOptions (emitter table)
                                                            ▼
                          native AI SDK image model   OR   custom ImageGenerationTransport
                          (OpenAI / Google / compat)       (DashScope / PPIO / DMXAPI custom families)
```

Two halves, one canonical vocabulary in the middle:

- **Read half** — registry `supports` → form fields → `painting.params`.
- **Write half** — `painting.params` → partitioned params → vendor wire body.

The contract between them is the **canonical key set**: the form, the registry,
and `canonicalGenerate` all agree on names like `size`, `numImages`,
`negativePrompt`, `seed`, `aspectRatio`, `imageResolution`. Vendor renames
(`negative_prompt`, `batchSize`, `imageConfig.imageSize`, …) happen only in the
adapter at the very end.

---

## Registry schema

Source of truth: [`packages/provider-registry/src/schemas/model.ts`](../../../packages/provider-registry/src/schemas/model.ts) (`ImageGenerationSupportSchema`).

```ts
interface ImageGenerationSupport {
  modes: Partial<Record<ImageGenerationMode, ModeDef>> // generate | edit | remix | upscale | merge
}

interface ModeDef {
  supports: Record<string, SupportSpec> // canonical-key → control spec
  vendorTransport?: { endpoint: string; isSync?: boolean } // per-model routing hint
  requirePrompt?: boolean // default true; false for no-prompt models (qwen-mt-image, upscalers)
}

type SupportSpec =
  | { type: 'switch'; default?: boolean }
  | { type: 'enum';   options: string[]; default?: string; render?: 'select' | 'chips'; columns?: number }
  | { type: 'range';  min: number; max: number; default?: number; step?: number }
  | { type: 'size';   minSide: number; maxSide: number; pairedEnumKey?: string }
  | { type: 'text';   multiline?: boolean }
```

`supports` is a **uniform map keyed by canonical name**. There is no
field-special-casing in the schema — `size`, `numImages`, `customSize` are all
just entries with a `SupportSpec`. The schema does **not** enumerate the legal
canonical keys; the only place a canonical key is "registered" for the UI is its
label row in `KEY_LABELS` (below).

### Where a model's block lives, and resolution order

A model's `imageGeneration` block can sit in two files:

- [`packages/provider-registry/data/models.json`](../../../packages/provider-registry/data/models.json) — the **base** entry. Use this for a model whose params are provider-agnostic (the official OpenAI/Google/etc. contract — `gpt-image-1`, `gemini-3-pro-image`).
- [`packages/provider-registry/data/provider-models.json`](../../../packages/provider-registry/data/provider-models.json) — a **provider override** keyed by `{ providerId, modelId }`. Use this for vendor-flavored params or vendor-exclusive models (a gateway's own SKUs, DashScope's wan/qwen families).

Resolution is **override-wins**, in `ProviderRegistryService.getImageGenerationSupport` ([`src/main/data/services/ProviderRegistryService.ts`](../../../src/main/data/services/ProviderRegistryService.ts)):

```
registryOverride.imageGeneration   ??   presetModel.imageGeneration   ??   null
```

Lookup tolerates id normalization (`findOverride` / `findModel` fall back to the
normalized id), so a wire id with dots (`wan2.5-i2i-preview`) and a sanitized id
(`wan2-5-i2i-preview`) resolve to the same entry.

> If `getImageGenerationSupport` returns `null`, the form is empty. That is the
> usual cause of "this model has no form": the base entry lacks an
> `imageGeneration` block **and** no provider override supplies one.

---

## Read half — registry → form

The renderer fetches the block over DataApi and turns it into widgets:

1. **Fetch** — `useImageGenerationSupport(providerId, modelId)` ([`src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts`](../../../src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts)) queries `GET /providers/:providerId/models/:modelId*/image-generation-support` (SWR-cached; revalidates on registry mutations).

2. **Map** — `imageGenerationToFields(support, { mode })` ([`src/renderer/pages/paintings/form/imageGenerationToFields.ts`](../../../src/renderer/pages/paintings/form/imageGenerationToFields.ts)) iterates `modes[mode].supports` and dispatches each entry through `specToField` by `spec.type`:

   | `SupportSpec.type` | widget (`BaseConfigItem`) |
   | --- | --- |
   | `switch` | toggle |
   | `enum` (`render:'chips'`) | chip row (size / aspectRatio / imageResolution) |
   | `enum` (default) | select dropdown |
   | `range` | slider |
   | `size` | custom width×height inputs (gated on `pairedEnumKey === 'custom'`) |
   | `text` | input / textarea (`multiline`) |

   No per-vendor branches, no hardcoded key list. If the requested mode is
   absent, it falls back to the model's first declared mode (each painting
   provider shows one tab).

3. **Label** — `KEY_LABELS` in the same file maps each canonical key to its i18n
   title/tooltip. This is the **only registry of canonical keys for the UI**.
   A key with no `KEY_LABELS` entry renders with the raw key as its title.

Form edits write into **`painting.params`** — a flat `Record<string, unknown>`
keyed by canonical name. Defaults are committed (not just displayed) when the
model is selected, by `computeModelFieldReset` ([`src/renderer/pages/paintings/utils/computeModelFieldReset.ts`](../../../src/renderer/pages/paintings/utils/computeModelFieldReset.ts)) — it writes each new model's `spec.default`, clears params the new model doesn't accept, and resets enum carry-overs that are invalid for the new model.

---

## Write half — params → vendor request

### 1. Partition (`canonicalGenerate`)

[`src/renderer/pages/paintings/model/canonicalGenerate.ts`](../../../src/renderer/pages/paintings/model/canonicalGenerate.ts) splits every `painting.params` entry into two buckets:

- **`AI_SDK_NATIVE_KEYS`** (after `POSITIONAL_RENAME`: `size→imageSize`, `numImages→batchSize`) → `aiSdkParams`, the positional AI SDK call options.
- **everything else** → `providerBag` = `providerOptions[providerId]`, forwarded by reference (so non-JSON callbacks like `onProgress` survive the plugin chain).

Empty / `undefined` / `null` values are dropped here — the server applies its
own default; no client-side defaults are invented. The `'auto'` sentinel is
**not** dropped at this stage: it's carried through and resolved to "omit the
field" one stage later by the emitters (e.g. `toDashScopeSize` /
`resolveSizeParameter` in `dashscopeTransport.ts`).

### 2. Transport routing hint (`paintingPipeline`)

[`src/renderer/pages/paintings/model/paintingPipeline.ts`](../../../src/renderer/pages/paintings/model/paintingPipeline.ts) reads the resolved mode's `vendorTransport` and `requirePrompt`, then:

- injects `painting.params.modelDescriptor = { id, endpoint, isSync, mode }` so a custom transport can route by it (PPIO-style async endpoints), and
- threads `requirePrompt` into `canonicalGenerate` so no-prompt models (qwen-mt-image, upscalers) skip the empty-prompt guard.

### 3. providerOptions emitters (`buildImageProviderOptions`)

[`src/main/ai/utils/imageOptions.ts`](../../../src/main/ai/utils/imageOptions.ts) is a **table of per-provider emitters** that map canonical params to each vendor's real wire field names and bag key:

```
EMITTERS: Record<providerId, Emitter>   // unlisted ids → diffusion fallback
```

- `openaiFamily` (openai / azure / newapi / cherryin …) → `{ quality, background, moderation, style }` dual-keyed under `openai` + the raw id.
- `diffusion` (silicon / zhipu / openrouter / …, the default) → snake_case `{ negative_prompt, seed, num_inference_steps, guidance_scale, prompt_enhancement, quality }`.
- `google` → `imageConfig.{aspectRatio, imageSize}` + Imagen `personGeneration` (lowercased for the AI SDK schema).
- `dashscope`, `dmxapi`, `aihubmix` → their own field sets / dual-keying.

This is where wire-format quirks live — snake_case renames, `imageConfig`
nesting, enum casing. Nowhere else.

### 4. The model itself

[`AiService.generateImage`](../../../src/main/ai/AiService.ts) (reached via the `Ai_GenerateImage` IPC) hands `aiSdkParams` + `providerOptions` to the resolved image model. The model is one of two kinds, decided by the provider factory:

- **Native AI SDK image model** — `OpenAIImageModel`, `@ai-sdk/google` `.image()`, `OpenAICompatibleImageModel`. Spreads `providerOptions[key]` into the request body.
- **Custom `ImageGenerationTransport`** — for async submit→poll vendors or non-OpenAI wire shapes (DashScope, PPIO, DMXAPI's Doubao/Wan/async-Qwen families). See [`src/main/ai/provider/custom/imageGenerationModel.ts`](../../../src/main/ai/provider/custom/imageGenerationModel.ts); each vendor's transport lives beside its provider in a per-vendor folder (e.g. [`dmxapi/dmxapiTransport.ts`](../../../src/main/ai/provider/custom/dmxapi/dmxapiTransport.ts)), with shared helpers in [`transportUtils.ts`](../../../src/main/ai/provider/custom/transportUtils.ts). Multi-backend gateways (DMXAPI) dispatch by a `{match, family}` table on the model id — see [`dmxapi/dmxapiProvider.ts`](../../../src/main/ai/provider/custom/dmxapi/dmxapiProvider.ts).

---

## Recipes

### Add a parameter to a model

1. Pick the **canonical key** (reuse an existing one if the param already exists elsewhere — `seed`, `negativePrompt`, …).
2. If it's new to the UI, add a `KEY_LABELS` row in `imageGenerationToFields.ts` and the i18n strings (`pnpm i18n:sync`).
3. Declare it in the model's `supports` with the right `SupportSpec`.
4. If it must reach the wire under a different name / bag, handle it in the vendor's emitter (`imageOptions.ts`) or transport — **only** if it isn't already an `AI_SDK_NATIVE_KEYS` field that the adapter handles.

### Add a model

- Provider-agnostic official model (OpenAI/Google contract) → add the `imageGeneration` block to the **base** entry in `models.json`.
- Vendor-flavored or vendor-exclusive → add a `{ providerId, modelId, imageGeneration }` override in `provider-models.json` (set `apiModelId` to the wire id; standalone models also set `name`/`capabilities`/`inputModalities`).
- Async / non-OpenAI wire shape → add `vendorTransport.endpoint` (+ `isSync`) and ensure the vendor's transport recognizes the model's family.

### Add a vendor

- OpenAI-compatible? Nothing custom needed — the `diffusion` fallback emitter + `OpenAICompatibleImageModel` cover it.
- Native SDK (OpenAI/Google/Anthropic backed)? Route by model family in the provider factory (see the DMXAPI `{match, family}` tables).
- Bespoke wire shape / async? Implement an `ImageGenerationTransport` and register it on the provider's `imageModel(...)`.

---

## Critical files

| Concern | File |
| --- | --- |
| Registry schema | `packages/provider-registry/src/schemas/model.ts` |
| Base model data | `packages/provider-registry/data/models.json` |
| Provider overrides | `packages/provider-registry/data/provider-models.json` |
| Resolver (override ?? base) | `src/main/data/services/ProviderRegistryService.ts` |
| Support fetch hook | `src/renderer/pages/paintings/hooks/useImageGenerationSupport.ts` |
| Registry → form fields | `src/renderer/pages/paintings/form/imageGenerationToFields.ts` |
| Default population on switch | `src/renderer/pages/paintings/utils/computeModelFieldReset.ts` |
| Param partition | `src/renderer/pages/paintings/model/canonicalGenerate.ts` |
| Transport hint + requirePrompt | `src/renderer/pages/paintings/model/paintingPipeline.ts` |
| providerOptions emitters | `src/main/ai/utils/imageOptions.ts` |
| Custom transport wrapper | `src/main/ai/provider/custom/imageGenerationModel.ts` |
| Vendor provider + transport | `src/main/ai/provider/custom/<vendor>/{<vendor>Provider,<vendor>Transport}.ts` |
| Shared transport helpers | `src/main/ai/provider/custom/transportUtils.ts` |
```
