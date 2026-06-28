import { describe, expect, it } from 'vitest'

import { CANONICAL_PARAM_KEY } from '../schemas/enums'
import { IMAGE_PARAM_CATALOG_KEYS, parseImageParams } from '../schemas/imageParamCatalog'
import type { ImageGenerationSupport } from '../schemas/model'
import { buildParamsSchema } from '../utils/buildParamsSchema'

describe('IMAGE_PARAM_CATALOG', () => {
  it('is exhaustive over CANONICAL_PARAM_KEY (no missing / extra keys)', () => {
    expect([...IMAGE_PARAM_CATALOG_KEYS].sort()).toEqual(Object.values(CANONICAL_PARAM_KEY).sort())
  })
})

describe('parseImageParams (catalog-only boundary re-type)', () => {
  it('coerces canonical value types (seed string → int, numImages string → int)', () => {
    expect(parseImageParams({ seed: '42', numImages: '2', negativePrompt: 'blur' })).toEqual({
      seed: 42,
      numImages: 2,
      negativePrompt: 'blur'
    })
  })

  it('passes unknown keys through (loose) and soft-fails to raw on a bad bag', () => {
    expect(parseImageParams({ cfg: 7.5, modelDescriptor: { id: 'x' } })).toMatchObject({
      cfg: 7.5,
      modelDescriptor: { id: 'x' }
    })
    expect(parseImageParams('not-an-object')).toBe('not-an-object')
  })
})

describe('buildParamsSchema', () => {
  const support = {
    modes: {
      generate: {
        supports: {
          seed: { type: 'text' },
          numImages: { type: 'range', min: 1, max: 4 },
          size: { type: 'enum', options: ['1024x1024', '768x1344'] },
          customSize: { type: 'size', minSide: 512, maxSide: 2048, pairedEnumKey: 'size' }
        }
      }
    }
  } as unknown as ImageGenerationSupport

  const schema = buildParamsSchema(support, 'generate')

  it('coerces the form string seed to a number once', () => {
    expect(schema.parse({ seed: '42', numImages: 2 })).toMatchObject({ seed: 42, numImages: 2 })
  })

  it('treats a blank seed as omitted (not 0)', () => {
    expect(schema.parse({ seed: '' }).seed).toBeUndefined()
  })

  it('drops an out-of-range value instead of failing the whole submit', () => {
    expect(schema.parse({ numImages: 9 }).numImages).toBeUndefined()
  })

  it('enforces enum membership but allows the customSize "custom" sentinel', () => {
    expect(schema.parse({ size: '1024x1024' }).size).toBe('1024x1024')
    expect(schema.parse({ size: '999' }).size).toBeUndefined()
    expect(schema.parse({ size: 'custom' }).size).toBe('custom')
  })

  it('parses synthetic customSize width/height as bounded numbers', () => {
    expect(schema.parse({ customSize_width: '1024', customSize_height: '768' })).toMatchObject({
      customSize_width: 1024,
      customSize_height: 768
    })
  })

  it('passes through unknown/legacy keys untouched (loose)', () => {
    expect(schema.parse({ somethingLegacy: 'x' })).toMatchObject({ somethingLegacy: 'x' })
  })

  it('returns an empty loose object when the model declares no image support', () => {
    expect(buildParamsSchema(undefined).parse({ anything: 1 })).toMatchObject({ anything: 1 })
  })
})
