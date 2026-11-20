import { type AI_SDK_NATIVE_BINDINGS, nativeBindingFor } from './aiSdkNativeBindings'

type NativeBindings = typeof AI_SDK_NATIVE_BINDINGS

/** The structured fields + leftover vendor bag split out of a canonical `paramValues` bag. */
export interface SplitImageParams<T extends Record<string, unknown>> {
  /** Binding-owned keys and normalization results; identity fields keep their input types. */
  readonly structured: {
    [K in keyof NativeBindings as NativeBindings[K]['option']]?: NativeBindings[K] extends {
      map: (...args: never[]) => infer Value
    }
      ? Value
      : T[K]
  }
  /** Non-binding canonical keys (cfg, addWatermark, modelDescriptor, …). */
  readonly vendorBag: Record<string, T[keyof T]>
}

/**
 * Partition a canonical `paramValues` bag into the structured fields the AI SDK
 * call consumes (via `AI_SDK_NATIVE_BINDINGS`) vs the leftover vendor bag the
 * WireProfile engine (`buildVendorProviderOptions`) forwards. The inverse of the
 * renderer's old `canonicalGenerate` partition, moved to main after the IPC
 * payload collapse.
 *
 * This partition does not validate the whole bag. Bindings normalize native
 * fields; unbound values retain their input type.
 *
 * The `'' | null | undefined` skip mirrors the renderer's old `place()` guard
 * exactly — it is the byte-identical-wire invariant (e.g. an empty-string `size`
 * must NOT survive to `resolveImageRequestSize`).
 */
export function splitParamValues<T extends Record<string, unknown>>(paramValues: T): SplitImageParams<T> {
  const structured: Record<string, T[keyof T] | string> = {}
  const vendorBag: Record<string, T[keyof T]> = {}
  for (const [key, value] of Object.entries<T[keyof T]>(paramValues)) {
    if (value === undefined || value === '' || value === null) continue
    const binding = nativeBindingFor(key) // numImages → n; aspectRatio normalized once; rest identity
    if (binding) {
      const mapped = binding.map ? binding.map(value) : value
      if (mapped !== undefined && mapped !== null && mapped !== '') structured[binding.option] = mapped
    } else {
      vendorBag[key] = value
    }
  }
  return { structured: structured, vendorBag }
}
