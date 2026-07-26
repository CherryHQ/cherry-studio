/**
 * Per-provider declaration of the NON-native vendor body params (the
 * `negative_prompt` / `quality` / … fields that ride in the request body).
 * Native params (`n`/`size`/`seed`/`aspectRatio`) are routed centrally by
 * `AI_SDK_NATIVE_BINDINGS`; the engine (`buildImageRequest`) maps a canonical
 * `paramValues` bag to the vendor body via these rules — replacing the
 * hand-written per-vendor body builders (`diffusionBody` / `openaiImageBody` /
 * the snake_case maps) one provider family at a time.
 *
 * Delivery (which provider key(s) the body rides under, and whether unmapped
 * vendor-bag fields pass through) is NOT the profile's concern — it's the
 * {@link WireRegistration} (`dualOpenAI` / `passthrough`) + the adapter
 * (`buildVendorProviderOptions`).
 */
import type { CanonicalParamKey } from '@shared/data/types/model'
import type { JSONValue } from 'ai'

import type { AppProviderId, KnownAppProviderId } from '../../../types'
import { normalizeAspectRatio } from '../../../utils/aiSdkNativeBindings'

/**
 * An EXPLICIT-OVERRIDE rule for a param whose wire treatment isn't the plain
 * `wireName(key) → value` default — either an explicit `to` (e.g. google's
 * camelCase provider-option name) + optional `map` transform, or a `contribute`
 * escape hatch (one-to-many / nested). Plain snake_case fields don't need a rule;
 * they go in `WireProfile.forward`.
 */
export interface WireRule {
  /** Literal wire field name (overrides `wireName(key)`). Omit when using `contribute`. */
  to?: string
  /** Value transform for the `to` field; may read sibling params via `all`. */
  map?: (value: unknown, all: Record<string, unknown>) => JSONValue
  /** One-to-many / nested escape hatch: return a partial body merged into the
   *  result (nested plain objects are deep-merged, e.g. google's `imageConfig`
   *  assembled from `aspectRatio` + `size`). Mutually exclusive with `to`/`map`. */
  contribute?: (value: unknown, all: Record<string, unknown>) => Record<string, JSONValue>
}

export interface WireProfile {
  /** Plain fields: forwarded as `wireName(key) → value` (the catalog supplies the
   *  snake_case name). The common case — no per-param rename declared here. */
  forward?: CanonicalParamKey[]
  /** Explicit overrides (irregular wire name / value transform / nested block). */
  fields?: Partial<Record<CanonicalParamKey, WireRule>>
}

/**
 * OpenAI-compatible diffusion family (SiliconFlow / zhipu / deepseek / ppio /
 * openrouter / any unlisted compat provider). Reproduces the old `diffusionBody`
 * — the providers' real snake_case sampling fields, `seed` duplicated into the
 * body. Registered with `passthrough` so vendor-bag fields the profile doesn't
 * map (SiliconFlow Qwen-Image's `cfg`, …) still ride through, exactly as the
 * legacy `diffusion` emitter's `jsonBagFields` merge did. The `silicon` boundary
 * test is the oracle.
 */
export const DIFFUSION_WIRE_PROFILE: WireProfile = {
  forward: ['negativePrompt', 'seed', 'numInferenceSteps', 'guidanceScale', 'promptEnhancement', 'quality']
}

/**
 * OpenAI image family (gpt-image / dall-e / newapi / cherryin / azure / …).
 * Reproduces `openaiImageBody` — the OpenAI image-body fields only; no `seed`
 * (OpenAI's own model rejects it, and aggregators that accept it keep their own
 * profile). Dual-keyed under `openai` + the provider id by the registry.
 */
export const OPENAI_WIRE_PROFILE: WireProfile = {
  forward: ['quality', 'background', 'moderation', 'style']
}

/**
 * aihubmix aggregator. Reproduces the `aihubmix` emitter: the OpenAI image body
 * PLUS `seed` (aihubmix's backends — Doubao Seedream / Qwen-Image / FLUX / iRAG /
 * Ideogram — mostly accept `seed`, unlike OpenAI's own model). Dual-keyed under
 * `openai` + `aihubmix` by the registry.
 */
export const AIHUBMIX_WIRE_PROFILE: WireProfile = {
  forward: [...(OPENAI_WIRE_PROFILE.forward ?? []), 'seed']
}

/** OpenRouter's native `/images` JSON body. `n`/`size`/`seed`/`aspectRatio` are
 * supplied by the AI SDK's typed image options; these are the remaining model-
 * advertised fields that must ride under `providerOptions.openrouter`. */
export const OPENROUTER_WIRE_PROFILE: WireProfile = {
  forward: ['resolution', 'quality', 'outputFormat', 'background'],
  fields: {
    outputCompression: {
      contribute: (value, all): Record<string, JSONValue> => {
        if (all.outputFormat === 'jpeg' || all.outputFormat === 'webp') {
          return { output_compression: value as JSONValue }
        }
        return {}
      }
    }
  }
}

/**
 * Doubao (Volcengine Ark) via `@ai-sdk/bytedance`. That package's option schema is
 * camelCase and does the vendor naming itself (`outputFormat` → `output_format`,
 * `maxImages` → `sequential_image_generation_options.max_images`), so this profile only
 * renames the two canonical keys whose Ark option name differs. Everything else rides
 * verbatim via `passthrough` — which is also what keeps `sequentialImageGeneration:
 * 'auto'` alive: {@link buildImageRequest}'s `skipValue` treats `'auto'` as "unset",
 * but for Ark it is the value that ENABLES group images.
 */
export const DOUBAO_WIRE_PROFILE: WireProfile = {
  fields: {
    imageResolution: { to: 'size' },
    addWatermark: { to: 'watermark' }
  }
}

/** `aspectRatio` (normalized) → google `imageConfig.aspectRatio`. Shared by the
 *  google family and the dmxapi gateway's google-routed block; an invalid value
 *  contributes nothing, so the deep-merge leaves no `imageConfig.aspectRatio`. */
const aspectRatioImageConfigRule: WireRule = {
  contribute: (v): Record<string, JSONValue> => {
    const normalized = normalizeAspectRatio(String(v))
    return normalized ? { imageConfig: { aspectRatio: normalized } } : {}
  }
}

/** `imageResolution` (1K/2K/4K — a vendor-bag field, NOT the native `size`) →
 *  google `imageConfig.imageSize`. Gemini image models expose `imageResolution`;
 *  `@ai-sdk/google` reads it as `providerOptions.<key>.imageConfig.imageSize`.
 *  Shared by the google / google-vertex family and the dmxapi google-routed block. */
const imageResolutionImageConfigRule: WireRule = {
  contribute: (v): Record<string, JSONValue> => (typeof v === 'string' ? { imageConfig: { imageSize: v } } : {})
}

/**
 * Google native image family (`@ai-sdk/google` gemini-image / Imagen).
 * Reproduces the `google` emitter: a flat lowercased `personGeneration` (the
 * registry stores it uppercase like `@google/genai`'s `ALLOW_ALL`, but
 * `@ai-sdk/google`'s option schema validates lowercase) + an `imageConfig` block
 * assembled from `aspectRatio` (normalized) and `size` via `contribute`.
 * Gemini-image reads `providerOptions.google.imageConfig`; Imagen reads the
 * top-level `aspectRatio` (which still flows via the native binding into
 * imageParams), so emitting it here is required for the former, harmless for the
 * latter. The empty `imageConfig` is dropped by the contribute deep-merge.
 */
export const GOOGLE_WIRE_PROFILE: WireProfile = {
  fields: {
    personGeneration: { to: 'personGeneration', map: (v) => String(v).toLowerCase() },
    aspectRatio: aspectRatioImageConfigRule,
    // Gemini image models expose `imageResolution` (1K/2K/4K); Imagen/legacy expose
    // `size`. Both land in `imageConfig.imageSize`. (A model exposes one or the other.)
    imageResolution: imageResolutionImageConfigRule,
    size: { contribute: (v) => ({ imageConfig: { imageSize: v as JSONValue } }) }
  }
}

/**
 * Ollama's own experimental image-gen models (`x/z-image-turbo`,
 * `x/flux2-klein`, served through `/api/generate`). Only `numInferenceSteps`
 * needs a rule — its wire name is `steps`, not the catalog's auto snake_case
 * `num_inference_steps` — since `size`/`seed` reach `ollamaTransport` via the
 * native AI SDK call options (`input.size`/`input.seed`), never this profile.
 */
export const OLLAMA_WIRE_PROFILE: WireProfile = {
  fields: {
    numInferenceSteps: { to: 'steps' }
  }
}

/** A provider's engine registration: its body profile + delivery flags. */
export interface WireRegistration {
  readonly profile: WireProfile
  /** Dual-key the body under `openai` AND the provider id (OpenAI image family). */
  readonly dualOpenAI?: boolean
  /** Forward vendor-bag fields the profile doesn't map — the legacy
   *  `jsonBagFields` merge, profile-mapped fields winning on collision.
   *  `true` forwards the raw canonical camelCase keys (custom SDK models —
   *  cherryin / aihubmix / dashscope — read the bag under those names);
   *  `'wire'` additionally renames catalog keys to their vendor wire spelling
   *  (`wireName`: `imageResolution → size`, `addWatermark → watermark`, …) for
   *  bodies that go on the HTTP wire as-is (the openai-compatible fallback). */
  readonly passthrough?: boolean | 'wire'
  /** Additional bodies delivered under sibling provider keys (the dmxapi gateway
   *  routes a `google.imageConfig` block to the google adapter). Each is built
   *  from the same `paramValues` and emitted only when non-empty. */
  readonly also?: ReadonlyArray<{ readonly key: string; readonly profile: WireProfile }>
}

/**
 * Registration for concrete providers riding the generic `openai-compatible`
 * SDK path (zhipu / tokenhub / …). Same diffusion profile, but the passthrough
 * applies the catalog's `wireName` renames: this body IS the HTTP request body
 * (`OpenAICompatibleImageModel` spreads `providerOptions[name]` into it
 * verbatim), so the vendor spelling — `watermark`, `size` — must be used, not
 * the canonical camelCase. A provider on this path needing a bespoke body shape
 * gets routed to its own provider id instead (config.ts builders — doubao is the
 * precedent), which gives it its own {@link WIRE_REGISTRY} row.
 */
export const OPENAI_COMPAT_FALLBACK_REGISTRATION: WireRegistration = {
  profile: DIFFUSION_WIRE_PROFILE,
  passthrough: 'wire'
}

/**
 * AI SDK provider id → its engine registration, declaring the provider's bespoke
 * delivery (dual-keying / passthrough / sibling keys). Providers absent from this
 * map fall back to {@link DEFAULT_DIFFUSION_REGISTRATION}. Grows one row per
 * migrated provider with bespoke delivery; the plain diffusion family needs no row.
 *
 * Keyed by {@link KnownAppProviderId}, not `string`: a row for an id no extension
 * registers is dead config that still reads as a live declaration, which is what
 * `wireRegistryReachability` had to catch at runtime. `Partial<Record<…>>` because the
 * map is deliberately incomplete — absence means "take the diffusion catch-all".
 */
export const WIRE_REGISTRY = {
  openrouter: { profile: OPENROUTER_WIRE_PROFILE },
  openai: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'openai-chat': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  azure: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'azure-responses': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  huggingface: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  // passthrough: CherryIn's own Google-image wrapper (@cherrystudio/ai-sdk-provider)
  // reads raw camelCase personGeneration/imageResolution off this key — those aren't
  // OPENAI_WIRE_PROFILE fields, so without passthrough they're silently dropped.
  cherryin: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true, passthrough: true },
  // The provider resolver upgrades cherryin's default chat endpoint to this variant
  // (provider/config.ts), so 'cherryin-chat' — not 'cherryin' — is the id AiService
  // actually looks up for the common image-generation path. The delivery key stays
  // `cherryin` (the wrapper's own fixed namespace) via `resolveProviderOptionsKey`.
  'cherryin-chat': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true, passthrough: true },
  newapi: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  google: { profile: GOOGLE_WIRE_PROFILE },
  // Vertex reuses the google body; `resolveProviderOptionsKey` delivers it under `vertex`.
  'google-vertex': { profile: GOOGLE_WIRE_PROFILE },
  // No `dashscope` row: every DashScope image model resolves a transport
  // (`imageTransportRegistry`), which takes the canonical bag and builds its own
  // envelope — a profile here would never be read. See `wireRegistryReachability`.
  doubao: { profile: DOUBAO_WIRE_PROFILE, passthrough: true },
  // passthrough: forward the vendor bag (imageResolution / addWatermark /
  // sequentialImageGeneration / responseFormat …) under the `aihubmix` key, where
  // the per-backend custom model (Doubao Seedream / Qwen / Wan …) reads it. The
  // `openai` mirror stays clean (mapped fields only).
  aihubmix: { profile: AIHUBMIX_WIRE_PROFILE, dualOpenAI: true, passthrough: true },
  // No `dmxapi` row: `config.ts` only gives DMXAPI its own SDK id under
  // `dmxapiUsesCustomTransport`, which is the same predicate that gives it a transport
  // — so `providerId === 'dmxapi'` always took the job branch, and every other DMXAPI
  // image model resolves `openai-compatible`. Its profile and `also: google` block were
  // unreachable from both sides. Reconnecting the gateway's native image adapters is a
  // routing change in `config.ts`, not a row here. See `wireRegistryReachability`.
  ollama: { profile: OLLAMA_WIRE_PROFILE },
  // The generic adapter every provider without an `adapterFamily` collapses onto.
  // Its body IS the HTTP body (`OpenAICompatibleImageModel` spreads
  // `providerOptions[name]` verbatim), so its passthrough is wire-named — see
  // OPENAI_COMPAT_FALLBACK_REGISTRATION below.
  'openai-compatible': OPENAI_COMPAT_FALLBACK_REGISTRATION
} as const satisfies Partial<Record<KnownAppProviderId, WireRegistration>>

/**
 * Fallback for any provider not in {@link WIRE_REGISTRY} and not on the legacy
 * emitter allowlist — the OpenAI-compatible diffusion family (silicon and every
 * unlisted compat provider). Byte-identical to the legacy `diffusion` emitter.
 */
export const DEFAULT_DIFFUSION_REGISTRATION: WireRegistration = {
  profile: DIFFUSION_WIRE_PROFILE,
  passthrough: true
}

/**
 * The registration for a resolved SDK provider id — a plain table lookup, falling
 * back to the raw diffusion catch-all. `openai-compatible` is a row like any other
 * ({@link OPENAI_COMPAT_FALLBACK_REGISTRATION}); it needs no branch here.
 */
export function resolveWireRegistration(sdkProviderId: AppProviderId): WireRegistration {
  // One lookup widening: the CALLER's id is open (`AppProviderId` admits any string for
  // user-created providers), while the TABLE's keys are closed. Widening here keeps
  // every row key checked without forcing the caller to prove membership.
  return (WIRE_REGISTRY as Partial<Record<string, WireRegistration>>)[sdkProviderId] ?? DEFAULT_DIFFUSION_REGISTRATION
}
