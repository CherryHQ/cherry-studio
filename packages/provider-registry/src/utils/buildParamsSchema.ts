/**
 * Compose a per-(model, mode) param validation schema from the central
 * {@link IMAGE_PARAM_CATALOG} (value types) and the model's registry
 * `supports` block (per-model constraints: options / range).
 *
 * The catalog owns each param's coercion + value type; the per-model
 * `SupportSpec` is layered on top as additive `.refine` constraints — we never
 * rebuild a fresh zod from the spec (that would lose the catalog's coercion).
 * Each field is `.catch(undefined)` and the object is `.loose()` so one bad /
 * legacy / uncatalogued value never fails the whole submit — the caller treats
 * a parse failure as non-fatal during migration.
 */
import * as z from 'zod'

import type { CanonicalParamKey } from '../schemas/enums'
import { IMAGE_PARAM_CATALOG } from '../schemas/imageParamCatalog'
import type { ImageGenerationMode, ImageGenerationSupport, SupportSpec } from '../schemas/model'

function resolveModeSupports(
  support: ImageGenerationSupport | undefined,
  mode: ImageGenerationMode
): Partial<Record<CanonicalParamKey, SupportSpec>> | undefined {
  const modes = support?.modes
  if (!modes) return undefined
  // Prefer the requested mode; fall back to the first declared mode (mirrors
  // the form's `imageGenerationToFields` resolution).
  const firstMode = Object.keys(modes)[0]
  const def = modes[mode] ?? (firstMode ? modes[firstMode] : undefined)
  return def?.supports
}

/** Layer the per-model constraint onto the catalog's base value schema. */
function applyConstraints(base: z.ZodTypeAny, spec: SupportSpec): z.ZodTypeAny {
  switch (spec.type) {
    case 'enum':
      // Allow the `'custom'` sentinel the size-pairing widget emits.
      return base.refine((v) => v == null || v === 'custom' || spec.options.includes(String(v)), {
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

export function buildParamsSchema(
  support: ImageGenerationSupport | undefined,
  mode: ImageGenerationMode = 'generate'
): z.ZodType<Record<string, unknown>> {
  const supports = resolveModeSupports(support, mode)
  if (!supports) return z.object({}).loose()

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, spec] of Object.entries(supports) as [CanonicalParamKey, SupportSpec][]) {
    const entry = IMAGE_PARAM_CATALOG[key]
    if (!entry) continue
    shape[key] = applyConstraints(entry.schema as z.ZodTypeAny, spec).catch(undefined)

    // The `customSize` widget stores typed width/height under synthetic
    // `<key>_width` / `<key>_height` keys (not canonical), bounded by the spec.
    if (spec.type === 'size') {
      const side = z.preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        z.coerce.number().min(spec.minSide).max(spec.maxSide).optional()
      )
      shape[`${key}_width`] = side.catch(undefined)
      shape[`${key}_height`] = side.catch(undefined)
    }
  }
  return z.object(shape).loose()
}
