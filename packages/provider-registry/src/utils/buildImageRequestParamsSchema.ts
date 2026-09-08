import { IMAGE_PARAM_CATALOG_KEYS, imageParamsSchema } from '../schemas/imageParamCatalog'
import type { SupportSpec } from '../schemas/model'
import type { EffectiveImageCapability } from './imageCapabilities'

function acceptsDimensions(value: string, spec: Extract<SupportSpec, { type: 'size' }>): boolean {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) return false
  return [Number(match[1]), Number(match[2])].every((side) => side >= spec.minSide && side <= spec.maxSide)
}

/** Validate submitted canonical values; unlike draft parsing, explicit mistakes never disappear. */
export function buildImageRequestParamsSchema({ supports }: Pick<EffectiveImageCapability, 'supports'>) {
  return imageParamsSchema.strict().superRefine((params, ctx) => {
    for (const key of IMAGE_PARAM_CATALOG_KEYS) {
      const value = params[key]
      if (value === undefined) continue
      const spec = supports[key]
      if (spec === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Parameter is not supported by this model' })
        continue
      }

      let valid = true
      switch (spec.type) {
        case 'enum': {
          const pairedSize = Object.values(supports).find(
            (entry) => entry.type === 'size' && entry.pairedEnumKey === key
          )
          valid = spec.options.includes(String(value)) && value !== 'custom'
          if (!valid && typeof value === 'string' && pairedSize?.type === 'size') {
            valid = acceptsDimensions(value, pairedSize)
          }
          break
        }
        case 'range':
          valid = typeof value === 'number' && value >= spec.min && value <= spec.max
          break
        case 'size':
          valid = typeof value === 'string' && acceptsDimensions(value, spec)
          break
      }
      if (!valid)
        ctx.addIssue({ code: 'custom', path: [key], message: 'Value is outside the model parameter constraints' })
    }
  })
}
