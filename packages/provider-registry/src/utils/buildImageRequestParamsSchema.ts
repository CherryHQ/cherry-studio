import * as z from 'zod'

import type { CanonicalParamKey } from '../schemas/enums'
import { IMAGE_PARAM_CATALOG, IMAGE_PARAM_CATALOG_KEYS, imageParamsSchema } from '../schemas/imageParamCatalog'
import type { SupportSpec } from '../schemas/model'
import type { EffectiveImageCapability } from './imageCapabilities'

function dimensionsSchema(spec: Extract<SupportSpec, { type: 'size' }>) {
  return z
    .string()
    .regex(/^\d+x\d+$/, 'Expected WIDTHxHEIGHT')
    .refine(
      (value) =>
        value
          .split('x')
          .map(Number)
          .every((side) => side >= spec.minSide && side <= spec.maxSide),
      'Size side out of range'
    )
}

/** Canonical field constraints shared by submitted requests and tool schemas; no coercion or defaults. */
export function buildImageParamSchema(
  key: CanonicalParamKey,
  supports: EffectiveImageCapability['supports']
): z.ZodType {
  const spec = supports[key]
  if (spec === undefined) return z.never({ error: 'Parameter is not supported by this model' })
  const base = IMAGE_PARAM_CATALOG[key].schema.unwrap()
  switch (spec.type) {
    case 'range':
      if (!(base instanceof z.ZodNumber)) throw new Error(`Range parameter ${key} must have a numeric catalog type`)
      return base.min(spec.min).max(spec.max)
    case 'enum': {
      const options = z.enum(spec.options.filter((value) => value !== 'custom'))
      const pairedSize = Object.values(supports).find((entry) => entry.type === 'size' && entry.pairedEnumKey === key)
      const schema = pairedSize?.type === 'size' ? z.union([options, dimensionsSchema(pairedSize)]) : options
      return schema.refine((value) => base.safeParse(value).success, 'Invalid canonical parameter value')
    }
    case 'size':
      return dimensionsSchema(spec)
    default:
      return base
  }
}

/** Validate submitted canonical values; unlike draft parsing, explicit mistakes never disappear. */
export function buildImageRequestParamsSchema({ supports }: Pick<EffectiveImageCapability, 'supports'>) {
  const fields = IMAGE_PARAM_CATALOG_KEYS.map((key) => ({ key, schema: buildImageParamSchema(key, supports) }))
  return imageParamsSchema.strict().superRefine((params, ctx) => {
    for (const { key, schema } of fields) {
      const value = params[key]
      if (value === undefined) continue
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] })
      }
    }
  })
}
