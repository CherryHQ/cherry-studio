import type { CanonicalParamKey, ParamValues } from '@cherrystudio/provider-registry'

import { nativeBindingFor, type NativeImageParams, type NativeParamKey } from './aiSdkNativeBindings'

/**
 * The catalog keys that are NOT routed natively — exactly what the WireProfile engine
 * forwards and what every transport's `Pick<ParamValues, …>` alias must be a subset
 * of. Derived as the complement of the native bindings so the two halves cannot drift:
 * adding a native binding removes the key from here in the same edit.
 */
export type VendorBag = Omit<ParamValues, NativeParamKey>

/** The structured fields + leftover vendor bag split out of a canonical `paramValues` bag. */
export interface SplitImageParams {
  /** The binding-mapped AI SDK call options (`numImages → n`, `aspectRatio` normalized). */
  readonly structured: NativeImageParams
  /** Non-binding canonical keys (cfg, addWatermark, negativePrompt, …). */
  readonly vendorBag: VendorBag
}

/**
 * Partition a canonical `paramValues` bag into the structured fields the AI SDK
 * call consumes (via `AI_SDK_NATIVE_BINDINGS`) vs the leftover vendor bag the
 * WireProfile engine (`buildVendorProviderOptions`) forwards.
 *
 * Takes `ParamValues`, not `Record<string, unknown>`: the `ai.generate_image` IPC
 * boundary already PROVED the bag is a `ParamValues` (`imageParamsSchema` strips every
 * non-catalog key), and re-widening here threw that proof away — every consumer
 * downstream then had to re-assert it with a cast. The two accumulators below stay
 * loose and are narrowed once at the `return`, the same trade `imageParamCatalog`
 * makes for its own dynamically-built shape.
 *
 * The `'' | null | undefined` skip mirrors the renderer's old `place()` guard
 * exactly — it is the byte-identical-wire invariant (e.g. an empty-string `size`
 * must NOT survive to `resolveImageRequestSize`).
 */
export function splitParamValues(paramValues: ParamValues): SplitImageParams {
  const structured: Record<string, unknown> = {}
  const vendorBag: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(paramValues)) {
    if (value === undefined || value === '' || value === null) continue
    // numImages → n; aspectRatio normalized once; the rest identity.
    const binding = nativeBindingFor(key as CanonicalParamKey)
    if (binding) {
      const mapped = binding.map ? binding.map(value as never) : value
      if (mapped !== undefined && mapped !== null && mapped !== '') structured[binding.option] = mapped
    } else {
      vendorBag[key] = value
    }
  }
  return { structured: structured as NativeImageParams, vendorBag: vendorBag as VendorBag }
}
