/**
 * Per-provider declaration of the NON-native vendor body params (the
 * `negative_prompt` / `quality` / … fields that ride in the request body).
 * Native params (`n`/`size`/`seed`/`aspectRatio`) are routed centrally by
 * `AI_SDK_NATIVE_BINDINGS`; the engine (`buildImageRequest`) maps a canonical
 * `paramValues` bag to the vendor body via these rules — replacing the
 * hand-written per-vendor body builders (`diffusionBody` / `openaiImageBody` /
 * the snake_case maps) one provider family at a time.
 *
 * Delivery (which provider key(s) the body rides under) is NOT the profile's
 * concern — it's the {@link WIRE_REGISTRY} registration (`dualOpenAI`) + the
 * adapter (`buildVendorProviderOptions`).
 */
import type { CanonicalParamKey } from '@shared/data/types/model'
import type { JSONValue } from 'ai'

import { SILICON_PROVIDER_NAME } from '../silicon/siliconProvider'

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
 * OpenAI-compatible diffusion family (SiliconFlow / zhipu / deepseek / …).
 * Reproduces the old `diffusionBody` + vendor-bag passthrough — the
 * `siliconProvider` boundary test is the oracle: canonical → the providers'
 * snake_case sampling fields, `seed` duplicated into the body, `cfg` passed
 * through.
 */
export const DIFFUSION_WIRE_PROFILE: WireProfile = {
  fields: {
    negativePrompt: { to: 'negative_prompt' },
    seed: { to: 'seed' },
    numInferenceSteps: { to: 'num_inference_steps' },
    guidanceScale: { to: 'guidance_scale' },
    promptEnhancement: { to: 'prompt_enhancement' },
    quality: { to: 'quality' },
    cfg: { to: 'cfg' }
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

/** A provider's engine registration: its body profile + delivery. */
export interface WireRegistration {
  readonly profile: WireProfile
  /** Dual-key the body under `openai` AND the provider id (OpenAI image family). */
  readonly dualOpenAI?: boolean
}

/**
 * AI SDK provider id → its engine registration. A provider here routes its
 * vendor body through `buildImageRequest` instead of `buildImageProviderOptions`;
 * absent providers keep the legacy emitter. Grows one row per migrated provider.
 */
export const WIRE_REGISTRY: Record<string, WireRegistration> = {
  [SILICON_PROVIDER_NAME]: { profile: DIFFUSION_WIRE_PROFILE },
  openai: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'openai-chat': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  azure: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  'azure-responses': { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  huggingface: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  cherryin: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true },
  newapi: { profile: OPENAI_WIRE_PROFILE, dualOpenAI: true }
}
