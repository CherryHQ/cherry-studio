import type { JSONValue } from 'ai'

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
import { IMAGE_PARAM_CATALOG } from '@cherrystudio/provider-registry'
import type { CanonicalParamKey } from '@shared/data/types/model'

import type { AppProviderId, KnownAppProviderId } from '../../../types'

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

function openRouterWireProfile(modelId: string): WireProfile {
  switch (modelId) {
    case 'black-forest-labs/flux.2-flex':
    case 'black-forest-labs/flux.2-pro': {
      const providerSlug = modelId === 'black-forest-labs/flux.2-flex' ? 'black-forest-labs/us-3' : 'black-forest-labs'
      return {
        ...OPENROUTER_WIRE_PROFILE,
        fields: {
          ...OPENROUTER_WIRE_PROFILE.fields,
          safetyTolerance: {
            contribute: (value) => ({
              provider: {
                options: {
                  [providerSlug]: { safety_tolerance: IMAGE_PARAM_CATALOG.safetyTolerance.schema.unwrap().parse(value) }
                }
              }
            })
          }
        }
      }
    }
    case 'openai/gpt-image-1':
    case 'openai/gpt-image-1-mini':
      return {
        ...OPENROUTER_WIRE_PROFILE,
        fields: {
          ...OPENROUTER_WIRE_PROFILE.fields,
          moderation: {
            contribute: (value) => ({
              provider: {
                options: { openai: { moderation: IMAGE_PARAM_CATALOG.moderation.schema.unwrap().parse(value) } }
              }
            })
          }
        }
      }
    default:
      return OPENROUTER_WIRE_PROFILE
  }
}

/**
 * Doubao (Volcengine Ark) via `@ai-sdk/bytedance`. That package's option schema is
 * camelCase and does the vendor naming itself (`outputFormat` → `output_format`,
 * `maxImages` → `sequential_image_generation_options.max_images`), so this profile only
 * renames the two canonical keys whose Ark option name differs. Other SDK options,
 * including `sequentialImageGeneration: 'auto'`, ride verbatim via `passthrough`.
 */
export const DOUBAO_WIRE_PROFILE: WireProfile = {
  fields: {
    imageResolution: { to: 'size' },
    addWatermark: { to: 'watermark' }
  }
}

/** Google consumes canonical ratios; only explicit `auto` omits the field. */
const aspectRatioImageConfigRule: WireRule = {
  contribute: (v): Record<string, JSONValue> => {
    const aspectRatio = IMAGE_PARAM_CATALOG.aspectRatio.schema.unwrap().parse(v)
    return aspectRatio === 'auto' ? {} : { imageConfig: { aspectRatio } }
  }
}

/** `imageResolution` (1K/2K/4K — a vendor-bag field, NOT the native `size`) →
 *  google `imageConfig.imageSize`. Gemini image models expose `imageResolution`;
 *  `@ai-sdk/google` reads it as `providerOptions.<key>.imageConfig.imageSize`.
 *  Shared by the google / google-vertex family and the dmxapi google-routed block.
 *  Google has no `auto` wire value; that selection leaves sizing to the model. */
const imageResolutionImageConfigRule: WireRule = {
  contribute: (v): Record<string, JSONValue> =>
    typeof v === 'string' && v !== 'auto' ? { imageConfig: { imageSize: v } } : {}
}

/**
 * Google native image family (`@ai-sdk/google` gemini-image / Imagen).
 * Reproduces the `google` emitter: a flat lowercased `personGeneration` (the
 * registry stores it uppercase like `@google/genai`'s `ALLOW_ALL`, but
 * `@ai-sdk/google`'s option schema validates lowercase) + an `imageConfig` block
 * assembled from the canonical `aspectRatio` and `size` via `contribute`.
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
    size: imageResolutionImageConfigRule
  }
}

/** MiniMax image API fields that differ from the canonical catalog names. */
export const MINIMAX_WIRE_PROFILE: WireProfile = {
  fields: {
    addWatermark: { to: 'aigc_watermark' },
    outputFormat: { to: 'response_format' },
    promptEnhancement: { to: 'prompt_optimizer' }
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
 * map use model-aware resolution or {@link DEFAULT_DIFFUSION_REGISTRATION}.
 * The plain diffusion family needs no row.
 *
 * Keyed by {@link KnownAppProviderId}: a row for an unregistered id is dead config.
 */
export const WIRE_REGISTRY = {
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
  ppio: { profile: {}, passthrough: true },
  dashscope: { profile: {}, passthrough: true },
  tokenhub: { profile: {}, passthrough: true },
  modelscope: { profile: {}, passthrough: true },
  doubao: { profile: DOUBAO_WIRE_PROFILE, passthrough: true },
  aihubmix: { profile: {}, passthrough: true },
  dmxapi: { profile: {}, passthrough: true },
  ollama: { profile: {}, passthrough: true },
  ovms: { profile: {}, passthrough: true },
  silicon: { profile: {}, passthrough: true },
  minimax: { profile: MINIMAX_WIRE_PROFILE },
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

/** Resolve wire placement from the SDK provider and the exact API model ID. */
export function resolveWireRegistration(sdkProviderId: AppProviderId, modelId: string): WireRegistration {
  if (sdkProviderId === 'openrouter') return { profile: openRouterWireProfile(modelId) }
  // The caller's id is open, the table's keys are closed — widen for the lookup only.
  return (WIRE_REGISTRY as Partial<Record<string, WireRegistration>>)[sdkProviderId] ?? DEFAULT_DIFFUSION_REGISTRATION
}
