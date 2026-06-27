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

/** Maps one canonical param to a vendor body field. `to` is the literal wire
 *  name (no implicit snake_case); `map` is an optional value transform that may
 *  read sibling params via `all`. */
export interface WireRule {
  to: string
  map?: (value: unknown, all: Record<string, unknown>) => JSONValue
}

export interface WireProfile {
  fields: Partial<Record<CanonicalParamKey, WireRule>>
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
  fields: {
    negativePrompt: { to: 'negative_prompt' },
    seed: { to: 'seed' },
    numInferenceSteps: { to: 'num_inference_steps' },
    guidanceScale: { to: 'guidance_scale' },
    promptEnhancement: { to: 'prompt_enhancement' },
    quality: { to: 'quality' }
  }
}

/**
 * OpenAI image family (gpt-image / dall-e / newapi / cherryin / azure / …).
 * Reproduces `openaiImageBody` — the OpenAI image-body fields only; no `seed`
 * (OpenAI's own model rejects it, and aggregators that accept it keep their own
 * profile). Dual-keyed under `openai` + the provider id by the registry.
 */
export const OPENAI_WIRE_PROFILE: WireProfile = {
  fields: {
    quality: { to: 'quality' },
    background: { to: 'background' },
    moderation: { to: 'moderation' },
    style: { to: 'style' }
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
}

/**
 * AI SDK provider id → its engine registration. A provider here routes its
 * vendor body through `buildImageRequest` instead of `buildImageProviderOptions`.
 * Providers absent from BOTH this map and the legacy-emitter allowlist fall back
 * to {@link DEFAULT_DIFFUSION_REGISTRATION}. Grows one row per migrated provider
 * with bespoke delivery; the plain diffusion family needs no row.
 */
export const WIRE_REGISTRY: Record<string, WireRegistration> = {
  openai: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'openai-chat': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  azure: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'azure-responses': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  huggingface: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  cherryin: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  newapi: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true }
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
