/**
 * Central image-generation parameter catalog.
 *
 * The single source of truth for each canonical param's **value type** (the
 * zod `schema`) and its **vendor wire field name** (`wire` — see {@link wireName}).
 * Per-model `supports` (in the registry data) keeps only the per-model constraints
 * — options / default / range — and is composed with this catalog by
 * `buildParamsSchema`. The renderer derives its control kind from `SupportSpec.type`
 * (`imageGenerationToFields`), so no control kind lives here.
 *
 * Two invariants:
 *  - The catalog is **exhaustive** over `CanonicalParamKey`
 *    (`satisfies Record<CanonicalParamKey, …>`): a missing key is a compile
 *    error, an unknown key is a compile error. A runtime test additionally
 *    locks key-set equality with `CANONICAL_PARAM_KEY`.
 *  - The wire name is the **vendor API field name** (`negative_prompt`, …) — a
 *    vendor convention, NOT AI-SDK knowledge, so it belongs here. Only the
 *    AI-SDK-native routing (`n`/`size`/`seed`/`aspectRatio`) stays app-layer in
 *    `AI_SDK_NATIVE_BINDINGS`.
 */
import * as z from 'zod'

import type { CanonicalParamKey } from './enums'

export interface ImageParamCatalogEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** SINGLE source of truth for the param's value type. Always optional. */
  readonly schema: S
  /** Vendor wire field name override. Omit when it's the auto camelCase→snake_case
   *  form (the common case — see {@link wireName}); set only for irregulars. */
  readonly wire?: string
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
  addWatermark: { schema: optBool, wire: 'watermark' },
  aspectRatio: { schema: optString },
  background: { schema: optString },
  bottomScale: { schema: optNumber },
  cfg: { schema: optNumber },
  customSize: { schema: optString },
  detail: { schema: optNumber },
  enableInterleave: { schema: optBool },
  function: { schema: optString },
  guidanceScale: { schema: optNumber },
  imageResolution: { schema: optString, wire: 'size' },
  imageWeight: { schema: optNumber },
  isSketch: { schema: optBool },
  leftScale: { schema: optNumber },
  magicPromptOption: { schema: optBool },
  maxImages: { schema: optInt },
  moderation: { schema: optString },
  negativePrompt: { schema: optString },
  numImages: { schema: optInt },
  numInferenceSteps: { schema: optInt },
  outputFormat: { schema: optString },
  outputCompression: { schema: optInt },
  personGeneration: { schema: optString },
  promptEnhancement: { schema: optBool },
  promptExtend: { schema: optBool },
  quality: { schema: optString },
  resolution: { schema: optString },
  refMode: { schema: optString },
  refStrength: { schema: optNumber },
  renderingSpeed: { schema: optString },
  resemblance: { schema: optNumber },
  rightScale: { schema: optNumber },
  safetyTolerance: { schema: optInt },
  seed: { schema: optInt },
  sequentialImageGeneration: { schema: optString },
  size: { schema: optString },
  sourceLang: { schema: optString },
  strength: { schema: optNumber },
  style: { schema: optString },
  styleType: { schema: optString },
  targetLang: { schema: optString },
  thinkingMode: { schema: optBool },
  topScale: { schema: optNumber },
  upscaleFactor: { schema: optNumber }
} as const satisfies Record<CanonicalParamKey, ImageParamCatalogEntry>

/** Static value type of a canonical param, derived from its catalog schema. */
export type ParamValue<K extends CanonicalParamKey> = z.infer<(typeof IMAGE_PARAM_CATALOG)[K]['schema']>

/** Validated param bag: a partial map of canonical key → its typed value. */
export type ParamValues = { [K in CanonicalParamKey]?: ParamValue<K> }

/**
 * Catalog value schema — every canonical key's value schema as a single typed
 * `z.object` whose `z.infer` is exactly {@link ParamValues}. The one `as` is on
 * the dynamic `Object.fromEntries` SHAPE (provably the catalog keys → their
 * schemas); the output type then flows without a cast. Consumers (the
 * `ai.generate_image` IPC payload) use this to validate + coerce the bag with zod
 * AT THE BOUNDARY — non-catalog keys are stripped, per-model option/range
 * constraints stay in the renderer's `buildParamsSchema`.
 */
export const imageParamsSchema = z.object(
  Object.fromEntries(Object.entries(IMAGE_PARAM_CATALOG).map(([key, entry]) => [key, entry.schema])) as {
    [K in CanonicalParamKey]: (typeof IMAGE_PARAM_CATALOG)[K]['schema']
  }
)

/** The catalog entry for `key`. */
export function paramCatalogEntry(key: CanonicalParamKey): ImageParamCatalogEntry {
  return IMAGE_PARAM_CATALOG[key]
}

/** `camelCase` → `snake_case` (the default vendor wire spelling). */
function autoSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}

/**
 * The vendor wire field name for a canonical param: the catalog `wire` override
 * when set, else the auto camelCase→snake_case form. This is the SINGLE source
 * of the canonical→wire rename — every flat-body provider (silicon / dashscope /
 * dmxapi / aihubmix / …) derives its field name from here instead of repeating
 * the rename. Native params (`n`/`size`/`seed`/`aspectRatio`) are routed by
 * `AI_SDK_NATIVE_BINDINGS` and don't go through this.
 */
export function wireName(key: CanonicalParamKey): string {
  return paramCatalogEntry(key).wire ?? autoSnakeCase(key)
}

/** Every canonical key the catalog covers (for the exhaustiveness lock test). */
export const IMAGE_PARAM_CATALOG_KEYS = Object.keys(IMAGE_PARAM_CATALOG) as CanonicalParamKey[]
