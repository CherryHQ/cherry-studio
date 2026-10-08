import {
  type CanonicalParamKey,
  IMAGE_PARAM_CATALOG_KEYS,
  imageParamsSchema,
  type ParamValues
} from '@cherrystudio/provider-registry'

import { nativeBindingFor, type NativeImageParams, type NativeParamKey } from './aiSdkNativeBindings'

/**
 * The job path's bag: catalog keys not routed natively, derived as the complement of
 * the native bindings so adding a binding removes the key here in the same edit.
 * No index signature — reading a wire name off it is a compile error.
 */
export type VendorBag = Omit<ParamValues, NativeParamKey>

const vendorParamsSchema = imageParamsSchema.strict()

/** Native image options have one owner; custom adapters accept only canonical vendor fields. */
export function parseImageVendorParams(value: unknown): VendorBag {
  const params = vendorParamsSchema.parse(value)
  for (const key of IMAGE_PARAM_CATALOG_KEYS) {
    if (params[key] !== undefined && nativeBindingFor(key)) {
      throw new Error(`Image parameter '${key}' must use its native SDK option`)
    }
  }
  return params
}

/** The structured fields + leftover vendor bag split out of a canonical `paramValues` bag. */
export interface SplitImageParams {
  /** The binding-mapped AI SDK call options (`numImages → n`, automatic ratio omitted). */
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
    // numImages → n; explicit automatic ratio omitted; the rest identity.
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
