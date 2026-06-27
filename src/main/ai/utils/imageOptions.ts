import type { GenerateImageParams } from '@shared/types/image'

import { nativeBindingFor } from './aiSdkNativeBindings'

/**
 * Structural subset of the canonical image params that land in the structured
 * request fields (the AI SDK call options + each provider's vendor body). Both
 * `GenerateImageParams` and `EditImageParams` satisfy this. `background` /
 * `moderation` / `style` are OpenAI image-body fields carried alongside.
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
 * call consumes (via `AI_SDK_NATIVE_BINDINGS`) vs the leftover vendor bag the
 * WireProfile engine (`buildVendorProviderOptions`) forwards. The inverse of the
 * renderer's old `canonicalGenerate` partition, moved to main after the IPC
 * payload collapse.
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
