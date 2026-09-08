/**
 * Canonical param key → its structured request field (+ optional wire
 * normalization). After the `ai.image.generate` payload collapse, the renderer
 * sends one canonical `paramValues` bag; `splitParamValues` (in `imageOptions.ts`)
 * uses this table to partition it into the structured fields the AI SDK
 * `imageParams` consume vs the leftover vendor bag the WireProfile engine
 * forwards, applying each binding's `map` once.
 *
 * `numImages → n` is the only rename; `aspectRatio` carries a `map`
 * (`ASPECT_X_Y → X:Y`, the AI SDK `ImageModelV3CallOptions` shape) so the
 * normalization happens once here instead of scattered across `AiService` + the
 * emitters. The rest are identity. The first four are genuine AI SDK options;
 * the others are diffusion / OpenAI-image knobs that migrate into per-provider
 * WireProfiles in PR4+.
 */
import type { CanonicalParamKey, ParamValue } from '@cherrystudio/provider-registry'

/** A registry-declared `size`: `WxH` pixels, or a vendor shorthand (`1K`/`2K`/`4K`)
 *  that only that vendor's body understands. */
export type ImageSizeToken = `${number}x${number}` | (string & {})

/**
 * The four genuine `ImageModelV3CallOptions` image params. The anchor of the split:
 * the binding table is checked against it, `VendorBag` is its complement.
 */
export interface NativeImageParams {
  n?: number
  /** Wider than the SDK's `${number}x${number}` on purpose — see {@link ImageSizeToken}. */
  size?: ImageSizeToken
  seed?: number
  aspectRatio?: string
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

/**
 * Normalize the painting form's `ASPECT_X_Y` enum (or already-normalized `X:Y`)
 * into the `${number}:${number}` shape the AI SDK image option + Google/Imagen
 * accept. Returns `undefined` for blank / mismatched values so the field is
 * omitted. Idempotent (`X:Y → X:Y`), so emitters may re-apply it safely.
 */
export function normalizeAspectRatio(value: string | undefined): string | undefined {
  if (!value) return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(stripped) ? stripped : undefined
}

/** `numImages → n` is the only rename; `aspectRatio` normalizes once here. */
export const AI_SDK_NATIVE_BINDINGS = {
  numImages: { option: 'n' },
  size: { option: 'size' },
  seed: { option: 'seed' },
  aspectRatio: { option: 'aspectRatio', map: normalizeAspectRatio }
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
