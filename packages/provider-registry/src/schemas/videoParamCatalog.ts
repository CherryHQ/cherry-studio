/**
 * Central video-generation parameter catalog — the video counterpart of
 * {@link IMAGE_PARAM_CATALOG} (`imageParamCatalog.ts`).
 *
 * The single source of truth for each canonical video param's **value type**
 * (the zod `schema`). Per-model `videoGeneration.modes[mode].supports` (in the
 * registry data) keeps only the per-model constraints — options / default /
 * range — and is composed with this catalog by `buildVideoParamsSchema`. The
 * renderer derives its control kind from `SupportSpec.type`
 * (`videoGenerationToFields`), so no control kind lives here.
 *
 * Unlike the image catalog there is no `wire` field: the video vendor wire
 * spelling is owned per-provider by the `buildVideoProviderOptions` emitters
 * (main), which receive the typed canonical bag and map it explicitly.
 *
 * Invariant: the catalog is **exhaustive** over `CanonicalVideoParamKey`
 * (`satisfies Record<CanonicalVideoParamKey, …>`): a missing key is a compile
 * error, an unknown key is a compile error. A runtime test additionally locks
 * key-set equality with `CANONICAL_VIDEO_PARAM_KEY`.
 */
import * as z from 'zod'

import type { CanonicalVideoParamKey } from './enums'

export interface VideoParamCatalogEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** SINGLE source of truth for the param's value type. Always optional. */
  readonly schema: S
}

// ── Value-type helpers (mirroring imageParamCatalog) ─────────────────────────
// A blank text input (`''`) must read as "omitted", not coerce to `0`/`NaN`.
const blankToUndefined = (v: unknown): unknown => (v === '' || v == null ? undefined : v)
const optString = z.string().optional()
const optBool = z.boolean().optional()
const optNumber = z.preprocess(blankToUndefined, z.coerce.number().optional())
const optInt = z.preprocess(blankToUndefined, z.coerce.number().int().optional())

/**
 * Catalog. Plain object literal + `as const satisfies` so per-key schema types
 * survive for {@link VideoParamValue} (annotating the object would widen them).
 */
export const VIDEO_PARAM_CATALOG = {
  aspectRatio: { schema: optString },
  cameraFixed: { schema: optBool },
  cfg: { schema: optNumber },
  /** Seconds. Vendors with string-enum durations coerce back per-emitter (`String(duration)`). */
  duration: { schema: optNumber },
  fps: { schema: optInt },
  generateAudio: { schema: optBool },
  mode: { schema: optString },
  movementAmplitude: { schema: optString },
  negativePrompt: { schema: optString },
  personGeneration: { schema: optString },
  promptExtend: { schema: optBool },
  promptOptimizer: { schema: optBool },
  resolution: { schema: optString },
  seed: { schema: optInt },
  shotType: { schema: optString },
  size: { schema: optString },
  sound: { schema: optBool },
  watermark: { schema: optBool }
} as const satisfies Record<CanonicalVideoParamKey, VideoParamCatalogEntry>

/** Static value type of a canonical video param, derived from its catalog schema. */
export type VideoParamValue<K extends CanonicalVideoParamKey> = z.infer<(typeof VIDEO_PARAM_CATALOG)[K]['schema']>

/** Validated video param bag: a partial map of canonical key → its typed value. */
export type VideoParamValues = { [K in CanonicalVideoParamKey]?: VideoParamValue<K> }

/**
 * Catalog value schema — every canonical video key's value schema as a single
 * typed `z.object` whose `z.infer` is exactly {@link VideoParamValues}. The one
 * `as` is on the dynamic `Object.fromEntries` SHAPE (provably the catalog keys →
 * their schemas); the output type then flows without a cast. Consumers (the
 * `ai.generate_video` IPC payload) use this to validate + coerce the bag with
 * zod AT THE BOUNDARY — non-catalog keys are stripped, per-model option/range
 * constraints stay in the renderer's `buildVideoParamsSchema`.
 */
export const videoParamsSchema = z.object(
  Object.fromEntries(Object.entries(VIDEO_PARAM_CATALOG).map(([key, entry]) => [key, entry.schema])) as {
    [K in CanonicalVideoParamKey]: (typeof VIDEO_PARAM_CATALOG)[K]['schema']
  }
)

/** Every canonical video key the catalog covers (for the exhaustiveness lock test). */
export const VIDEO_PARAM_CATALOG_KEYS = Object.keys(VIDEO_PARAM_CATALOG) as CanonicalVideoParamKey[]
