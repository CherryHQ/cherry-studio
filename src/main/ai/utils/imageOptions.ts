import type { CanonicalParamKey, ParamValues } from '@cherrystudio/provider-registry'

import { nativeBindingFor, type NativeImageParams, type NativeParamKey } from './aiSdkNativeBindings'

/** The catalog keys not routed natively. Derived as the complement of the native
 *  bindings, so adding one removes the key from here in the same edit. */
export type VendorBag = Omit<ParamValues, NativeParamKey>

/** The structured fields + leftover vendor bag split out of a canonical `paramValues` bag. */
export interface SplitImageParams {
  /** The binding-mapped AI SDK call options (`numImages → n`, `aspectRatio` normalized). */
  readonly structured: NativeImageParams
  /** Non-binding canonical keys (cfg, addWatermark, negativePrompt, …). */
  readonly vendorBag: VendorBag
}

/**
 * Partition a canonical bag into the AI SDK call options vs the vendor bag.
 * Skipping `'' | null | undefined` is the byte-identical-wire invariant.
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
