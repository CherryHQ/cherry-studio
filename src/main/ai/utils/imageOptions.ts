import type { CanonicalParamKey, ParamValues } from '@cherrystudio/provider-registry'
import type { JSONValue } from 'ai'

import { nativeBindingFor, type NativeImageParams, type NativeParamKey } from './aiSdkNativeBindings'

/**
 * Two DIFFERENT vocabularies reach a transport's `providerParams`, and before this
 * brand one type described both — so `bag.num_inference_steps` (a wire name) and
 * `bag.negativePrompt` (a canonical key) were equally legal on the same value, and
 * reading the wrong one compiled into a field that can never arrive.
 *
 * The brand property is OPTIONAL so a plain object literal still assigns without a
 * cast; it only blocks assigning one spelling where the other is expected.
 */
declare const SPELLING: unique symbol

/** Canonical camelCase catalog keys, as `splitParamValues` produces them. */
export type Canonical<T> = T & { readonly [SPELLING]?: 'canonical' }

/** Vendor wire names, as the WireProfile engine produces them (`num_inference_steps`). */
export type Wire<T> = T & { readonly [SPELLING]?: 'wire' }

/**
 * The job path's bag: catalog keys not routed natively, derived as the complement of
 * the native bindings so adding a binding removes the key here in the same edit.
 * No index signature — reading a wire name off it is a compile error.
 */
export type VendorBag = Canonical<Omit<ParamValues, NativeParamKey>>

/**
 * The in-SDK path's bag (ovms / ollama): `providerOptions[key]`, i.e. the wire-named
 * body the WireProfile engine already built. Open by construction — the profile's
 * `passthrough` forwards keys no catalog owns.
 */
export type WireVendorBag = Wire<Record<string, JSONValue | undefined>>

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
