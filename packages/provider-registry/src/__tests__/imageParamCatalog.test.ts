import { describe, expect, it } from 'vitest'

import { CANONICAL_PARAM_KEY } from '../schemas/enums'
import { IMAGE_PARAM_CATALOG_KEYS, imageParamsSchema } from '../schemas/imageParamCatalog'
import type { ImageGenerationSupport } from '../schemas/model'
import { buildParamsSchema } from '../utils/buildParamsSchema'

describe('IMAGE_PARAM_CATALOG', () => {
  it('is exhaustive over CANONICAL_PARAM_KEY (no missing / extra keys)', () => {
    expect([...IMAGE_PARAM_CATALOG_KEYS].sort()).toEqual(Object.values(CANONICAL_PARAM_KEY).sort())
  })
})

describe('imageParamsSchema (catalog-only IPC boundary schema)', () => {
  it('coerces canonical value types (seed/numImages string → int)', () => {
    expect(imageParamsSchema.parse({ seed: '42', numImages: '2', negativePrompt: 'blur' })).toEqual({
      seed: 42,
      numImages: 2,
      negativePrompt: 'blur'
    })
  })

  it('keeps catalog keys and strips non-catalog keys (z.infer is exactly ParamValues)', () => {
    expect(imageParamsSchema.parse({ cfg: 7.5, notAParam: 'x' })).toEqual({ cfg: 7.5 })
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

  it('passes non-catalog keys through untouched when the model declares no image support', () => {
    expect(buildParamsSchema(undefined).parse({ anything: 1 })).toMatchObject({ anything: 1 })
  })

  it('still coerces/catches catalog keys with no per-model support block (custom/unregistered model)', () => {
    // A stale value carried over from a previous model (computeModelFieldReset
    // skips clearing when the new model has no registry block) must not ride raw
    // into the strict IPC-boundary schema and reject the whole ai.generate_image
    // request — the catalog's own `.catch(undefined)` still applies.
    const parsed = buildParamsSchema(undefined).parse({ seed: 'abc', numImages: '2', anything: 1 })
    expect(parsed.seed).toBeUndefined()
    expect(parsed.numImages).toBe(2)
    expect(parsed.anything).toBe(1)
  })

  it('coerces/catches a stale canonical key NOT in the current model support block (A3 regression)', () => {
    // Path: registered model → no-support model → registered model. The middle model
    // leaves a stale `seed` in painting.params, and the returned registered model does
    // NOT declare `seed` in its `supports`. Before the fix the supported branch only
    // caught declared keys and `.loose()` let `seed` ride RAW into the strict IPC
    // schema (`imageParamsSchema`, no `.catch`), rejecting the whole submit. Now every
    // catalog key is base-coerced first, then the model's constraints overlay.
    const onlyNumImages = {
      modes: { generate: { supports: { numImages: { type: 'range', min: 1, max: 4 } } } }
    } as unknown as ImageGenerationSupport
    const s = buildParamsSchema(onlyNumImages, 'generate')

    const parsed = s.parse({ seed: 'abc', numImages: '2', legacyExtra: 'x' })
    expect(parsed.seed).toBeUndefined() // stale invalid catalog key dropped, not passed raw
    expect(parsed.numImages).toBe(2) // supported key still coerced + range-constrained
    expect(parsed.legacyExtra).toBe('x') // genuinely non-catalog extra still passes via `.loose()`
    // a VALID stale value for an unsupported catalog key still coerces through (preserved)
    expect((s.parse({ seed: '7' }) as { seed?: number }).seed).toBe(7)
    // the cleaned bag now survives the strict IPC-boundary schema instead of rejecting
    expect(() => imageParamsSchema.parse(parsed)).not.toThrow()
  })
})
