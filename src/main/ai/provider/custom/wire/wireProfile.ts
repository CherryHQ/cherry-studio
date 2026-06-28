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

/**
 * DashScope native image API (qwen-image / wanx / wan2.5 / qwen-mt-image …).
 * Reproduces the `dashscope` emitter: the mapped sampling fields under the
 * `dashscope` key, over a `passthrough` of the vendor bag the submit/poll
 * transport reads (`modelDescriptor`, `sourceLang`/`targetLang`, …) — without it,
 * `dashscopeTransport.submit` throws "Missing modelDescriptor". Mapped fields win
 * over bag entries of the same name. The async transport runs on the job system;
 * this bag is what it receives as `providerParams`.
 */
export const DASHSCOPE_WIRE_PROFILE: WireProfile = {
  forward: ['negativePrompt', 'seed', 'style']
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
    size: { contribute: (v) => ({ imageConfig: { imageSize: v as JSONValue } }) }
  }
}

/**
 * dmxapi multi-backend gateway. The factory routes models to native adapters
 * (gemini-image/imagen → google, gpt-image/dall-e → openai, custom → bespoke
 * transport, else openai-compat), so the emitter dual-keys across two provider
 * keys: a snake_case body under `dmxapi` (primary profile) and a `google`
 * `imageConfig` block (the `also` profile) so gemini-image picks up the form's
 * `aspectRatio` + `imageResolution` (1K/2K/4K — no top-level AI SDK field).
 */
export const DMXAPI_WIRE_PROFILE: WireProfile = {
  forward: ['negativePrompt', 'seed', 'quality']
}

/** dmxapi's google-routed block: aspectRatio + `imageResolution` (a vendor-bag
 *  field, not `size`) into `imageConfig`. Delivered under the `google` key via
 *  the registration's `also`. */
export const DMXAPI_GOOGLE_PROFILE: WireProfile = {
  fields: {
    aspectRatio: aspectRatioImageConfigRule,
    imageResolution: {
      contribute: (v): Record<string, JSONValue> => (typeof v === 'string' ? { imageConfig: { imageSize: v } } : {})
    }
  }
}

/** A provider's engine registration: its body profile + delivery flags. */
export interface WireRegistration {
  readonly profile: WireProfile
  /** Dual-key the body under `openai` AND the provider id (OpenAI image family). */
  readonly dualOpenAI?: boolean
  /** Forward vendor-bag fields the profile doesn't map (diffusion family) — the
   *  legacy `jsonBagFields` merge, profile-mapped fields winning on collision. */
  readonly passthrough?: boolean
  /** Additional bodies delivered under sibling provider keys (the dmxapi gateway
   *  routes a `google.imageConfig` block to the google adapter). Each is built
   *  from the same `paramValues` and emitted only when non-empty. */
  readonly also?: ReadonlyArray<{ readonly key: string; readonly profile: WireProfile }>
}

/**
 * AI SDK provider id → its engine registration, declaring the provider's bespoke
 * delivery (dual-keying / passthrough / sibling keys). Providers absent from this
 * map fall back to {@link DEFAULT_DIFFUSION_REGISTRATION}. Grows one row per
 * migrated provider with bespoke delivery; the plain diffusion family needs no row.
 */
export const WIRE_REGISTRY: Record<string, WireRegistration> = {
  openai: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'openai-chat': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  azure: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'azure-responses': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  huggingface: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  cherryin: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  newapi: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  google: { profile: GOOGLE_WIRE_PROFILE },
  'google-vertex': { profile: GOOGLE_WIRE_PROFILE },
  dashscope: { profile: DASHSCOPE_WIRE_PROFILE, passthrough: true },
  // passthrough: forward the vendor bag (imageResolution / addWatermark /
  // sequentialImageGeneration / responseFormat …) under the `aihubmix` key, where
  // the per-backend custom model (Doubao Seedream / Qwen / Wan …) reads it. The
  // `openai` mirror stays clean (mapped fields only).
  aihubmix: { profile: AIHUBMIX_WIRE_PROFILE, dualOpenAI: true, passthrough: true },
  dmxapi: { profile: DMXAPI_WIRE_PROFILE, also: [{ key: 'google', profile: DMXAPI_GOOGLE_PROFILE }] }
}

/**
 * Fallback for any provider not in {@link WIRE_REGISTRY} and not on the legacy
 * emitter allowlist — the OpenAI-compatible diffusion family (silicon and every
 * unlisted compat provider). Byte-identical to the legacy `diffusion` emitter.
 */
export const DEFAULT_DIFFUSION_REGISTRATION: WireRegistration = {
  profile: DIFFUSION_WIRE_PROFILE,
  passthrough: true
}
