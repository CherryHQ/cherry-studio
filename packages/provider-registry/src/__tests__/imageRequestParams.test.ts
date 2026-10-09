import { describe, expect, it } from 'vitest'

import blackForestLabs from '../creators/black-forest-labs'
import google from '../creators/google'
import minimax from '../creators/minimax'
import tokenhub from '../providers/tokenhub'
import { buildImageRequestParamsSchema } from '../utils/buildImageRequestParamsSchema'
import { resolveImageCapability, resolveImageGenerationSupport } from '../utils/imageCapabilities'

const row = tokenhub.overrides?.find((entry) => entry.apiModelId === 'hy-image-v3')
if (!row) throw new Error('Missing Hunyuan declaration')
const declaration = resolveImageGenerationSupport(null, row)
const resolution = resolveImageCapability(declaration, 'generate', false)
if (resolution.kind !== 'supported') throw new Error('Hunyuan fixture missing')
const schema = buildImageRequestParamsSchema(resolution.capability)

describe('submitted image parameters', () => {
  it.each([google, blackForestLabs, minimax])(
    'accepts every declared $id ratio without inventing a default or auto capability',
    (creator) => {
      if (!creator.models) throw new Error(`Missing models for ${creator.id}`)
      const models = creator.models.filter((model) => model.imageGeneration?.supports.aspectRatio)
      expect(models.length).toBeGreaterThan(0)
      for (const model of models) {
        const resolved = resolveImageCapability(model.imageGeneration, 'generate', false)
        if (resolved.kind !== 'supported') throw new Error(`Missing image capability for ${model.id}`)
        const spec = resolved.capability.supports.aspectRatio
        if (spec?.type !== 'enum') throw new Error(`Missing ratio options for ${model.id}`)
        const params = buildImageRequestParamsSchema(resolved.capability)
        for (const aspectRatio of spec.options) {
          expect(params.parse({ aspectRatio })).toEqual({ aspectRatio })
        }
        expect(params.parse({})).toEqual({})
        expect(params.safeParse({ aspectRatio: 'auto' }).success).toBe(spec.options.includes('auto'))
      }
    }
  )

  it('preserves explicit seed zero and false without injecting registry defaults', () => {
    expect(schema.parse({ seed: 0, promptEnhancement: false })).toEqual({ seed: 0, promptEnhancement: false })
    expect(schema.parse({})).toEqual({})
  })

  it.each([
    { numImages: 2 },
    { seed: true },
    { seed: [] },
    { seed: 'invalid' },
    { promptEnhancement: 'false' },
    { prompt_enhancement: false },
    { size: 'custom' },
    { size: 'unknown-size' },
    { customSize_width: 1024 }
  ])('rejects unsupported, malformed and draft-only values %#', (input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  // https://cloud.tencent.com/document/product/1823/135745; retrieved 2026-09-09.
  it('accepts composed custom dimensions and rejects sides outside the declared range', () => {
    expect(schema.parse({ size: '512x2048' })).toEqual({ size: '512x2048' })
    for (const size of ['511x1024', '1024x2049', '512.5x1024', '512xInfinity']) {
      expect(schema.safeParse({ size }).success).toBe(false)
    }
  })

  it('rejects out-of-range values rather than silently omitting them', () => {
    const constrained = buildImageRequestParamsSchema({
      supports: { numImages: { type: 'range', min: 1, max: 4 }, size: { type: 'enum', options: ['1024x1024'] } }
    })
    expect(constrained.parse({ numImages: 4, size: '1024x1024' })).toEqual({ numImages: 4, size: '1024x1024' })
    for (const input of [{ numImages: 5 }, { numImages: 2.5 }, { size: '2048x2048' }]) {
      expect(constrained.safeParse(input).success).toBe(false)
    }
  })
})
