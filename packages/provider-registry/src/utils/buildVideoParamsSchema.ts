/**
 * Compose a per-(model, mode) video param validation schema from the central
 * {@link VIDEO_PARAM_CATALOG} (value types) and the model's registry
 * `videoGeneration.modes[mode].supports` block (per-model constraints:
 * options / range) — the video counterpart of `buildParamsSchema`.
 *
 * The catalog owns each param's coercion + value type; the per-model
 * `SupportSpec` is layered on top as additive `.refine` constraints — we never
 * rebuild a fresh zod from the spec (that would lose the catalog's coercion).
 * Each field is `.catch(undefined)` and the object is `.loose()` so one bad /
 * stale value never fails the whole submit. Video has no custom-size widget,
 * so there is no `'custom'` enum sentinel and no synthetic `_width`/`_height`
 * keys (a `size`-type spec constrains nothing beyond the catalog string).
 */
import * as z from 'zod'

import type { CanonicalVideoParamKey } from '../schemas/enums'
import type { SupportSpec, VideoGenerationMode, VideoGenerationSupport } from '../schemas/model'
import { VIDEO_PARAM_CATALOG } from '../schemas/videoParamCatalog'

function resolveModeSupports(
  support: VideoGenerationSupport | undefined,
  mode: VideoGenerationMode
): Partial<Record<CanonicalVideoParamKey, SupportSpec>> | undefined {
  const modes = support?.modes
  if (!modes) return undefined
  // Prefer the requested mode; fall back to the first declared mode (mirrors
  // the form's `videoGenerationToFields` resolution).
  const firstMode = Object.keys(modes)[0] as VideoGenerationMode | undefined
  const def = modes[mode] ?? (firstMode ? modes[firstMode] : undefined)
  return def?.supports
}

/** Layer the per-model constraint onto the catalog's base value schema. */
function applyConstraints(base: z.ZodTypeAny, spec: SupportSpec): z.ZodTypeAny {
  switch (spec.type) {
    case 'enum':
      return base.refine((v) => v == null || spec.options.includes(String(v)), {
        message: 'value not in supported options'
      })
    case 'range':
      return base.refine((v) => v == null || (Number(v) >= spec.min && Number(v) <= spec.max), {
        message: 'value out of range'
      })
    default:
      return base
  }
}

export function buildVideoParamsSchema(
  support: VideoGenerationSupport | undefined,
  mode: VideoGenerationMode = 't2v'
): z.ZodType<Record<string, unknown>> {
  // Base: EVERY catalog key coerced with `.catch(undefined)`, so a canonical
  // value left over from a previously-selected model is coerced/dropped here
  // rather than riding RAW through `.loose()` into the strict IPC-boundary
  // schema (`videoParamsSchema`, no `.catch`), which would reject the submit.
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, entry] of Object.entries(VIDEO_PARAM_CATALOG)) {
    shape[key] = (entry.schema as z.ZodTypeAny).catch(undefined)
  }

  const supports = resolveModeSupports(support, mode)
  if (!supports) return z.object(shape).loose()

  // Overlay this model's per-param constraints (options / range) on the base.
  for (const [key, spec] of Object.entries(supports) as [CanonicalVideoParamKey, SupportSpec][]) {
    const entry = VIDEO_PARAM_CATALOG[key]
    if (!entry) continue
    shape[key] = applyConstraints(entry.schema as z.ZodTypeAny, spec).catch(undefined)
  }
  return z.object(shape).loose()
}
