/**
 * Canonical param key → its structured request field (+ optional normalization).
 * After the `ai.generate_image` payload collapse, the renderer sends one canonical
 * `paramValues` bag; `splitParamValues` (in `imageOptions.ts`) uses this table to
 * partition it into the structured fields the AI SDK `imageParams` consume vs the
 * leftover vendor bag the WireProfile engine forwards, applying each `map` once.
 *
 * The table is **correlated**: for canonical key `K`, `option` must name a real field
 * of {@link NativeImageParams}, and `map` must accept `K`'s catalog value type and
 * return that field's type. Previously both were free (`option: string`,
 * `map: (v: unknown) => unknown`), so a typo like `option: 'sizes'` compiled and
 * silently deleted the param from BOTH the structured set and the vendor bag — a
 * disappearance the wire layer's dropped-params warning cannot see, because the value
 * never reaches the bag it inspects.
 */
import type { CanonicalParamKey, ParamValue } from '@cherrystudio/provider-registry'

/**
 * A registry-declared `size`: either `WxH` pixels or a vendor shorthand
 * (`1K` / `2K` / `4K`) that only that vendor's own body understands. Six Seedream
 * models in `provider-models.json` declare the latter, three of them defaulting to
 * `2K`, so this is not hypothetical — see {@link asSdkImageSize}.
 */
export type ImageSizeToken = `${number}x${number}` | (string & {})

/**
 * The genuine AI SDK `ImageModelV3CallOptions` image params (`@ai-sdk/provider`):
 * `n` / `size` / `seed` / `aspectRatio` (+ `files`/`mask`, handled separately via
 * `request.inputImages`/`mask`). EVERYTHING ELSE — negativePrompt, numInferenceSteps,
 * guidanceScale, quality, background, moderation, style, personGeneration, … — is NOT
 * a typed SDK option; the SDK's only channel for it is `providerOptions` (the vendor
 * body). Those flow through the vendor bag instead, never this table.
 *
 * This is the anchor of the split: the binding table is checked against it, and the
 * vendor bag is derived as its complement over the catalog.
 */
export interface NativeImageParams {
  n?: number
  /** Wider than the SDK's `${number}x${number}` on purpose — see {@link ImageSizeToken}. */
  size?: ImageSizeToken
  seed?: number
  aspectRatio?: string
}

type NativeOptionName = keyof NativeImageParams

/**
 * Per-key correlated binding shape. The inner mapped type is indexed by
 * `NativeOptionName` to produce a union of `{ option: O; map?: (…) => …[O] }`, which
 * is what ties `map`'s return type to the specific field `option` names.
 */
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

/**
 * `numImages → n` is the only rename; `aspectRatio` carries a `map` so the
 * normalization happens once here instead of scattered across `AiService` + the
 * emitters. `map` can be a bare function reference now that the table correlates its
 * parameter with the catalog value type — the old `typeof v === 'string'` guard was
 * only there because the signature said `unknown`.
 */
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
 * The one admitted widening in the image path.
 *
 * The AI SDK types its native `size` as `${number}x${number}`, but a registry `size`
 * is an {@link ImageSizeToken}: Seedream declares `1K`/`2K`/`4K` and its model reads
 * those verbatim off the body. We forward the token unchanged. Funnelled through a
 * named function so the lie is greppable, unit-testable, and cannot spread — it was
 * previously an inline `as` duplicated in `AiService` and the job handler, where it
 * read as a fact rather than a concession.
 */
export function asSdkImageSize(size: ImageSizeToken): `${number}x${number}` {
  return size as `${number}x${number}`
}
