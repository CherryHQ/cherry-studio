/**
 * Parse form drafts using catalog input normalization and shared model constraints.
 * Drafts retain the custom-size sentinel and uncatalogued widget state; invalid
 * values are cleared. This is not authoritative submitted-request validation.
 */
import * as z from 'zod'

import { IMAGE_PARAM_CATALOG_KEYS, imageParamsSchema, normalizeImageParamNumber } from '../schemas/imageParamCatalog'
import type { ImageGenerationSupport, ImageOperation } from '../schemas/model'
import { buildImageParamSchema } from './buildImageRequestParamsSchema'
import { resolveImageCapability } from './imageCapabilities'

export function buildParamsSchema(
  support: ImageGenerationSupport | undefined,
  operation: ImageOperation = 'generate',
  hasImages = false
): z.ZodType<Record<string, unknown>> {
  const resolution = resolveImageCapability(support, operation, hasImages)
  if (resolution.kind === 'unsupported') return z.never()

  // Normalize stale catalog values as well, so `.loose()` cannot pass them raw to IPC.
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const key of IMAGE_PARAM_CATALOG_KEYS) {
    const input: z.ZodType = imageParamsSchema.shape[key]
    shape[key] = input.catch(undefined)
  }

  if (resolution.kind === 'unconfigured') return z.object(shape).loose()
  const { supports } = resolution.capability

  for (const key of IMAGE_PARAM_CATALOG_KEYS) {
    const spec = supports[key]
    if (spec === undefined) continue
    let field = buildImageParamSchema(key, supports)
    if (
      spec.type === 'enum' &&
      Object.values(supports).some((entry) => entry.type === 'size' && entry.pairedEnumKey === key)
    ) {
      field = field.or(z.literal('custom'))
    }
    const input: z.ZodType = imageParamsSchema.shape[key]
    shape[key] = input.pipe(field.optional()).catch(undefined)

    // The `customSize` widget stores typed width/height under synthetic
    // `<key>_width` / `<key>_height` keys (not canonical), bounded by the spec.
    if (spec.type === 'size') {
      const side = z.preprocess(normalizeImageParamNumber, z.number().min(spec.minSide).max(spec.maxSide).optional())
      shape[`${key}_width`] = side.catch(undefined)
      shape[`${key}_height`] = side.catch(undefined)
    }
  }
  return z.object(shape).loose()
}
