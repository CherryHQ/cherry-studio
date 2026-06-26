/**
 * Per-provider declaration of the NON-native vendor body params (the
 * `negative_prompt` / `cfg` / … fields that ride in the request body). Native
 * params (`n`/`size`/`seed`/`aspectRatio`) are routed centrally by
 * `AI_SDK_NATIVE_BINDINGS`; the engine (`buildImageRequest`) maps a canonical
 * `paramValues` bag to the vendor body via these rules — replacing the
 * hand-written per-vendor body builders (`diffusionBody`, the snake_case maps).
 *
 * Scope note: a `transport` facet (endpoint + response parsing) joins this type
 * when a provider moves its FULL request to the engine (PR4+). The silicon slice
 * only uses `fields` — its body rides under `providerOptions.silicon` and the
 * response is still handled by `SiliconImageModel`, so the wire stays
 * byte-identical to the `buildImageProviderOptions` diffusion path.
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
 * SiliconFlow (the OpenAI-compatible diffusion family). Reproduces the old
 * `diffusionBody` + vendor-bag passthrough EXACTLY — the `siliconProvider`
 * boundary test is the oracle: canonical → the providers' snake_case sampling
 * fields, `seed` duplicated into the body (silicon reads it there too), `cfg`
 * passed through.
 */
export const SILICON_WIRE_PROFILE: WireProfile = {
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
 * AI SDK provider id → its WireProfile. A provider here routes its vendor body
 * through the engine instead of `buildImageProviderOptions`; absent providers
 * keep the legacy emitter. Grows one row per migrated provider (PR4+).
 */
export const WIRE_PROFILES: Record<string, WireProfile> = {
  [SILICON_PROVIDER_NAME]: SILICON_WIRE_PROFILE
}
