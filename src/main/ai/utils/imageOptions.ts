import type { GenerateImageParams } from '@shared/types/image'
import type { JSONValue } from 'ai'

import { nativeBindingFor, normalizeAspectRatio } from './aiSdkNativeBindings'

/**
 * Structural subset of the image params that {@link buildImageProviderOptions}
 * actually reads. Both `GenerateImageParams` and `EditImageParams` satisfy this,
 * so generate and edit can share one mapper. `background`/`moderation` are real
 * OpenAI image-body fields consumed by the unified newapi/cherryin/aionly path.
 */
export type ImageOptionParams = Partial<
  Pick<
    GenerateImageParams,
    | 'negativePrompt'
    | 'seed'
    | 'numInferenceSteps'
    | 'guidanceScale'
    | 'promptEnhancement'
    | 'personGeneration'
    | 'quality'
    | 'aspectRatio'
    | 'size'
    | 'providerOptions'
  >
> & { background?: string; moderation?: string; style?: string }

/** The structured fields + leftover vendor bag split out of a canonical `paramValues` bag. */
export interface SplitImageParams {
  /** `ImageOptionParams`-shaped (+ `n`): the binding-mapped structured fields. */
  readonly structured: ImageOptionParams & { n?: number }
  /** Non-binding canonical keys (cfg, addWatermark, modelDescriptor, …). */
  readonly vendorBag: Record<string, unknown>
}

/**
 * Partition a canonical `paramValues` bag into the structured fields the AI SDK
 * call + {@link buildImageProviderOptions} consume vs the leftover vendor bag.
 * The inverse of the renderer's old `canonicalGenerate` partition, moved to main
 * after the IPC payload collapse.
 *
 * The `'' | null | undefined` skip mirrors the renderer's old `place()` guard
 * exactly — it is the byte-identical-wire invariant (e.g. an empty-string `size`
 * must NOT survive to `resolveImageRequestSize`).
 */
export function splitParamValues(paramValues: Record<string, unknown>): SplitImageParams {
  const structured: Record<string, unknown> = {}
  const vendorBag: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(paramValues)) {
    if (value === undefined || value === '' || value === null) continue
    const binding = nativeBindingFor(key) // numImages → n; aspectRatio normalized once; rest identity
    if (binding) {
      const mapped = binding.map ? binding.map(value) : value
      if (mapped !== undefined && mapped !== null && mapped !== '') structured[binding.option] = mapped
    } else {
      vendorBag[key] = value
    }
  }
  return { structured: structured as ImageOptionParams & { n?: number }, vendorBag }
}

type ProviderOptions = Record<string, Record<string, JSONValue>>

/**
 * Parse the painting form's seed string into a number, or `undefined` when
 * blank / non-numeric (so it's omitted rather than sent as `NaN`).
 */
function parseSeed(seed: number | undefined): number | undefined {
  return typeof seed === 'number' && Number.isFinite(seed) ? seed : undefined
}

/**
 * Drop `undefined` / empty-string / `'auto'` entries. `'auto'` is the painting
 * UI sentinel for "let the provider decide" — it must not reach the wire as a
 * literal value (the bespoke newapi path omitted it).
 */
function compact(entries: Record<string, JSONValue | undefined>): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined && v !== '' && v !== 'auto') out[k] = v
  }
  return out
}

/** Wrap a field map under a single provider key, or `{}` when empty. */
function under(key: string, fields: Record<string, JSONValue>): ProviderOptions {
  return Object.keys(fields).length ? { [key]: fields } : {}
}

/**
 * Forward registry-declared vendor-bag fields that the structured params don't
 * cover (e.g. SiliconFlow Qwen-Image's `cfg`). The bag may also carry non-JSON
 * callbacks that ride through the plugin chain (e.g. the polling `onProgress`);
 * those are consumed off-band, so skip anything not JSON-serializable rather than
 * letting it leak into the request body.
 */
function jsonBagFields(bag: Record<string, unknown> | undefined): Record<string, JSONValue> {
  if (!bag) return {}
  const out: Record<string, JSONValue> = {}
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) continue
    out[k] = v as JSONValue
  }
  return out
}

/**
 * Dual-key the same field map under both `openai` and the resolved provider
 * id. The OpenAI image model reads `providerOptions.openai`; the OpenAI-
 * compatible model reads `providerOptions[<name>]`. Feeding both covers
 * whichever the resolved model picks (cherryin → `openai`, newapi → `newapi`).
 */
function dualOpenAI(rawProviderId: string, fields: Record<string, JSONValue>): ProviderOptions {
  return Object.keys(fields).length ? { openai: fields, [rawProviderId]: fields } : {}
}

// ── Field-group builders — canonical params → one vendor's wire field names ──

/** OpenAI image-body fields (gpt-image / dall-e). `seed` is unsupported by
 *  OpenAI's own model but accepted by aggregators, so it's opt-in. */
function openaiImageBody(p: ImageOptionParams, opts?: { seed?: number }): Record<string, JSONValue> {
  return compact({
    quality: p.quality,
    background: p.background,
    moderation: p.moderation,
    style: p.style,
    ...(opts?.seed !== undefined && { seed: opts.seed })
  })
}

/** OpenAI-compatible diffusion body (silicon / zhipu / deepseek / …): the
 *  providers' real snake_case sampling field names. */
function diffusionBody(p: ImageOptionParams, seed: number | undefined): Record<string, JSONValue> {
  return compact({
    negative_prompt: p.negativePrompt,
    seed,
    num_inference_steps: p.numInferenceSteps,
    guidance_scale: p.guidanceScale,
    prompt_enhancement: p.promptEnhancement,
    quality: p.quality
  })
}

/**
 * Google `imageConfig` block (`@ai-sdk/google.image()`): `aspectRatio` +
 * `imageSize`. Gemini-image reads `providerOptions.google.imageConfig`; Imagen
 * reads the top-level `aspectRatio` directly (AiProvider passes it normalized),
 * so emitting it here is a no-op for Imagen and required for Gemini-image.
 */
function googleImageConfig(aspectRatio: string | undefined, imageSize: string | undefined): Record<string, JSONValue> {
  return compact({ aspectRatio: normalizeAspectRatio(aspectRatio), imageSize })
}

// ── Per-provider emitters ──────────────────────────────────────────────────

type Emitter = (rawProviderId: string, p: ImageOptionParams, seed: number | undefined) => ProviderOptions

const openaiFamily: Emitter = (id, p) => dualOpenAI(id, openaiImageBody(p))

// aihubmix aggregates many backends (Doubao Seedream / Qwen-Image / FLUX /
// iRAG / Ideogram) — most accept `seed` in the body; route it through too.
const aihubmix: Emitter = (id, p, seed) => dualOpenAI(id, openaiImageBody(p, { seed }))

// DashScope native image API — every family puts `seed`/`negative_prompt`
// under `parameters.*`, plus `style` for wanx-v1. The transport reads these
// off `providerParams.*` since AI SDK doesn't forward them to `input.*`.
const dashscope: Emitter = (_id, p, seed) =>
  // Forward the registry vendor bag (modelDescriptor, sourceLang/targetLang, …) the
  // DashScope submit/poll transport reads, then overlay the mapped canonical fields.
  // Without the bag, `dashscopeTransport.submit` throws "Missing modelDescriptor".
  under('dashscope', {
    ...jsonBagFields(p.providerOptions?.dashscope),
    ...compact({ negative_prompt: p.negativePrompt, seed, style: p.style })
  })

// Google native image — `imageConfig` (aspectRatio + imageSize) plus the
// Imagen-only top-level `personGeneration`. The registry stores the option
// values uppercase (matching `@google/genai`'s `PersonGeneration` enum:
// `ALLOW_ALL`), but `@ai-sdk/google`'s provider-option schema validates the
// lowercase form (`allow_all`) — so normalize at this boundary.
const google: Emitter = (_id, p) => {
  const imageConfig = googleImageConfig(p.aspectRatio, p.size)
  const personGeneration = typeof p.personGeneration === 'string' ? p.personGeneration.toLowerCase() : undefined
  const googleOptions: Record<string, JSONValue> = { ...compact({ personGeneration }) }
  if (Object.keys(imageConfig).length) googleOptions.imageConfig = imageConfig
  return under('google', googleOptions)
}

// DMXAPI is a multi-backend gateway: the provider factory routes models to
// native AI SDK adapters (gemini-image / imagen → google, gpt-image / dall-e →
// openai, custom families → bespoke transport, else openai-compat). So we
// dual-key: snake_case fields under `dmxapi` for the compat / custom paths,
// and an `imageConfig` under `google` so gemini-image picks up the form's
// `aspectRatio` + `imageResolution` (1K/2K/4K — no top-level AI SDK field).
// `imageResolution` is a vendor-bag field (not in `ImageOptionParams`), so we
// read it back from the already-built `providerOptions.dmxapi` bag.
const dmxapi: Emitter = (_id, p, seed) => {
  const imageResolution = p.providerOptions?.dmxapi?.imageResolution
  const imageConfig = compact({
    aspectRatio: normalizeAspectRatio(p.aspectRatio),
    imageSize: typeof imageResolution === 'string' ? imageResolution : undefined
  })
  return {
    ...under('dmxapi', compact({ negative_prompt: p.negativePrompt, seed, quality: p.quality })),
    ...under('google', Object.keys(imageConfig).length ? { imageConfig } : {})
  }
}

// OpenAI-compatible / diffusion fallback (silicon, zhipu, deepseek, openrouter,
// and any unrecognized provider id). Merge any registry-declared vendor-bag fields
// (e.g. SiliconFlow's `cfg`) the fixed mapping below doesn't emit; mapped canonical
// params still win over a raw bag entry of the same name.
const diffusion: Emitter = (id, p, seed) =>
  under(id, { ...jsonBagFields(p.providerOptions?.[id]), ...diffusionBody(p, seed) })

/**
 * Provider id → emitter. Unlisted ids fall through to {@link diffusion}.
 * Adding a provider with bespoke wire fields = one row + one emitter.
 */
const EMITTERS: Record<string, Emitter> = {
  openai: openaiFamily,
  'openai-chat': openaiFamily,
  azure: openaiFamily,
  'azure-responses': openaiFamily,
  huggingface: openaiFamily,
  cherryin: openaiFamily,
  newapi: openaiFamily,
  aihubmix,
  dashscope,
  dmxapi,
  google,
  'google-vertex': google
}

/**
 * The provider ids still routed to {@link buildImageProviderOptions} rather than
 * the WireProfile engine — the bespoke emitters whose wire the engine doesn't
 * model yet (`dmxapi`'s cross-key dual-keying into `google.imageConfig`,
 * `aihubmix`'s `seed`-in-body). The openai / google / dashscope families and the
 * plain diffusion fallback have migrated, so they're absent. Shrinks to empty as
 * each migrates, at which point `buildImageProviderOptions` and this set both go
 * away.
 */
export const LEGACY_EMITTER_PROVIDERS: ReadonlySet<string> = new Set(['aihubmix', 'dmxapi'])

/**
 * Build AI SDK `providerOptions` for image generation, mirroring the chat-side
 * `buildProviderOptions` idiom (dispatch over the resolved AI SDK provider id).
 *
 * Why this exists: `AiProvider.modernGenerateImage` historically forwarded only
 * `prompt/size/n/abortSignal` and silently dropped `negativePrompt/seed/
 * numInferenceSteps/guidanceScale/promptEnhancement/personGeneration/quality`.
 * AI SDK image models spread `providerOptions[<providerOptionsKey>]` verbatim
 * into the request body (`@ai-sdk/openai-compatible` `OpenAICompatibleImageModel`
 * via `getArgs`; `@ai-sdk/openai` `OpenAIImageModel` via `providerOptions.openai`),
 * so each emitter maps the painting params to one vendor's real image-API field
 * names and returns them keyed by the provider id the resolved model reads.
 *
 * `rawProviderId` is `providerConfig.providerId` (== `getAiSdkProviderId(...)`),
 * the provider name the executor registered — i.e. the key
 * `OpenAICompatibleImageModel.providerOptionsKey` reads.
 */
export function buildImageProviderOptions(rawProviderId: string, params: ImageOptionParams): ProviderOptions {
  const emitter = EMITTERS[rawProviderId] ?? diffusion
  return emitter(rawProviderId, params, parseSeed(params.seed))
}
