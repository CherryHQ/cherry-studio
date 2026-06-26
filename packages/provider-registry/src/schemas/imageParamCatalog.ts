/**
 * Central image-generation parameter catalog.
 *
 * The single source of truth for each canonical param's **value type** (the
 * zod `schema`) and its default **control kind**. Per-model `supports` (in the
 * registry data) keeps only the per-model constraints — options / default /
 * range — and is composed with this catalog by `buildParamsSchema`.
 *
 * Two invariants:
 *  - The catalog is **exhaustive** over `CanonicalParamKey`
 *    (`satisfies Record<CanonicalParamKey, …>`): a missing key is a compile
 *    error, an unknown key is a compile error. A runtime test additionally
 *    locks key-set equality with `CANONICAL_PARAM_KEY`.
 *  - **No AI SDK / wire knowledge here** — only the canonical value type. Wire
 *    field names + transforms live in per-provider WireProfiles; AI-SDK-native
 *    routing lives in `AI_SDK_NATIVE_BINDINGS` (app layer).
 */
import * as z from 'zod'

import type { CanonicalParamKey } from './enums'

/** The control the renderer uses to collect this param's value. */
export type ParamControlKind = 'enum' | 'range' | 'switch' | 'text' | 'seedInput' | 'size'

export interface ImageParamCatalogEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** SINGLE source of truth for the param's value type. Always optional. */
  readonly schema: S
  /** Default control kind (consumed once the form is catalog-driven). */
  readonly control: ParamControlKind
}

// ── Value-type helpers ───────────────────────────────────────────────────────
// A blank text input (`''`) must read as "omitted", not coerce to `0`/`NaN`.
const blankToUndefined = (v: unknown): unknown => (v === '' || v == null ? undefined : v)
const optString = z.string().optional()
const optBool = z.boolean().optional()
const optNumber = z.preprocess(blankToUndefined, z.coerce.number().optional())
const optInt = z.preprocess(blankToUndefined, z.coerce.number().int().optional())

/**
 * Catalog. Plain object literal + `as const satisfies` so per-key schema types
 * survive for {@link ParamValue} (annotating the object would widen them).
 */
export const IMAGE_PARAM_CATALOG = {
  addWatermark: { schema: optBool, control: 'switch' },
  aspectRatio: { schema: optString, control: 'enum' },
  background: { schema: optString, control: 'enum' },
  bottomScale: { schema: optNumber, control: 'range' },
  cfg: { schema: optNumber, control: 'range' },
  customSize: { schema: optString, control: 'size' },
  detail: { schema: optNumber, control: 'range' },
  enableInterleave: { schema: optBool, control: 'switch' },
  function: { schema: optString, control: 'enum' },
  guidanceScale: { schema: optNumber, control: 'range' },
  imageResolution: { schema: optString, control: 'enum' },
  imageWeight: { schema: optNumber, control: 'range' },
  isSketch: { schema: optBool, control: 'switch' },
  leftScale: { schema: optNumber, control: 'range' },
  magicPromptOption: { schema: optBool, control: 'switch' },
  maxImages: { schema: optInt, control: 'range' },
  moderation: { schema: optString, control: 'enum' },
  negativePrompt: { schema: optString, control: 'text' },
  numImages: { schema: optInt, control: 'range' },
  numInferenceSteps: { schema: optInt, control: 'range' },
  outputFormat: { schema: optString, control: 'enum' },
  personGeneration: { schema: optString, control: 'enum' },
  promptEnhancement: { schema: optBool, control: 'switch' },
  promptExtend: { schema: optBool, control: 'switch' },
  quality: { schema: optString, control: 'enum' },
  refMode: { schema: optString, control: 'enum' },
  refStrength: { schema: optNumber, control: 'range' },
  renderingSpeed: { schema: optString, control: 'enum' },
  resemblance: { schema: optNumber, control: 'range' },
  rightScale: { schema: optNumber, control: 'range' },
  safetyTolerance: { schema: optInt, control: 'range' },
  seed: { schema: optInt, control: 'seedInput' },
  sequentialImageGeneration: { schema: optString, control: 'enum' },
  size: { schema: optString, control: 'enum' },
  sourceLang: { schema: optString, control: 'enum' },
  strength: { schema: optNumber, control: 'range' },
  style: { schema: optString, control: 'enum' },
  styleType: { schema: optString, control: 'enum' },
  targetLang: { schema: optString, control: 'enum' },
  thinkingMode: { schema: optBool, control: 'switch' },
  topScale: { schema: optNumber, control: 'range' },
  upscaleFactor: { schema: optNumber, control: 'range' }
} as const satisfies Record<CanonicalParamKey, ImageParamCatalogEntry>

/** Static value type of a canonical param, derived from its catalog schema. */
export type ParamValue<K extends CanonicalParamKey> = z.infer<(typeof IMAGE_PARAM_CATALOG)[K]['schema']>

/** Validated param bag: a partial map of canonical key → its typed value. */
export type ParamValues = { [K in CanonicalParamKey]?: ParamValue<K> }

/** The catalog entry for `key`. */
export function paramCatalogEntry(key: CanonicalParamKey): ImageParamCatalogEntry {
  return IMAGE_PARAM_CATALOG[key]
}

/** Every canonical key the catalog covers (for the exhaustiveness lock test). */
export const IMAGE_PARAM_CATALOG_KEYS = Object.keys(IMAGE_PARAM_CATALOG) as CanonicalParamKey[]
