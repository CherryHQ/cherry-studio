/**
 * Canonical param key → its structured request field (+ optional wire
 * normalization). After the `ai.image.generate` payload collapse, the renderer
 * sends one canonical `paramValues` bag; `splitParamValues` (in `imageOptions.ts`)
 * uses this table to partition it into the structured fields the AI SDK
 * `imageParams` consume vs the leftover vendor bag the WireProfile engine
 * forwards, applying each binding's `map` once.
 *
 * `numImages → n` is the only rename. Canonical ratios already match the SDK;
 * explicit `auto` omits the ratio so the server chooses it. Other values pass
 * through unchanged.
 */
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import type { CanonicalParamKey, ParamValue } from '@cherrystudio/provider-registry'

/** A registry-declared `size`: `WxH` pixels, or a vendor shorthand (`1K`/`2K`/`4K`)
 *  that only that vendor's body understands. */
export type ImageSizeToken = `${number}x${number}` | (string & {})

/**
 * The four genuine `ImageModelV3CallOptions` image params. The anchor of the split:
 * the binding table is checked against it, `VendorBag` is its complement.
 */
export type NativeImageParams = Partial<Pick<ImageModelV3CallOptions, 'n' | 'seed' | 'aspectRatio'>> & {
  /** Wider than the SDK's `${number}x${number}` on purpose — see {@link ImageSizeToken}. */
  size?: ImageSizeToken
}

type NativeOptionName = keyof NativeImageParams

/** Correlated per key: `option` must name a real native field, and `map` must take
 *  K's catalog value and return that field's type. */
type NativeBindingTable = {
  readonly [K in CanonicalParamKey]?: {
    readonly [O in NativeOptionName]: {
      readonly option: O
      readonly map?: (value: NonNullable<ParamValue<K>>) => NativeImageParams[O]
    }
  }[NativeOptionName]
}

/** Main validates ratios before this split; only explicit `auto` is omitted. */
export const AI_SDK_NATIVE_BINDINGS = {
  numImages: { option: 'n' },
  size: { option: 'size' },
  seed: { option: 'seed' },
  aspectRatio: {
    option: 'aspectRatio',
    map: (value: NonNullable<ParamValue<'aspectRatio'>>) => (value === 'auto' ? undefined : value)
  }
} as const satisfies NativeBindingTable

/** The catalog keys routed to {@link NativeImageParams} rather than the vendor bag. */
export type NativeParamKey = keyof typeof AI_SDK_NATIVE_BINDINGS

/** The binding entry for a canonical `key`, or `undefined` for vendor-bag params. */
export function nativeBindingFor(key: CanonicalParamKey): NativeBindingTable[CanonicalParamKey] {
  return AI_SDK_NATIVE_BINDINGS[key as NativeParamKey]
}

/**
 * The one admitted widening in the image path: the SDK types `size` as `WxH`, but
 * Seedream's declared `1K`/`2K`/`4K` are forwarded verbatim. Named so it can't spread.
 */
export function asSdkImageSize(size: ImageSizeToken): `${number}x${number}` {
  return size as `${number}x${number}`
}

/** Omit the size sentinel so the server chooses its own dimensions. */
export function resolveImageRequestSize(size: ImageSizeToken | undefined): ImageSizeToken | undefined {
  return size === 'auto' ? undefined : size
}
