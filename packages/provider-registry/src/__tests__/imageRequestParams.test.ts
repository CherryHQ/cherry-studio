import { describe, expect, it } from 'vitest'

import tokenhub from '../providers/tokenhub'
import { ImageGenerationSupportSchema } from '../schemas/model'
import { buildImageRequestParamsSchema } from '../utils/buildImageRequestParamsSchema'
import { resolveLegacyImageCapability } from '../utils/imageCapabilities'

const declaration = ImageGenerationSupportSchema.parse(
  tokenhub.overrides?.find((entry) => entry.apiModelId === 'hy-image-v3')?.imageGeneration
)
const resolution = resolveLegacyImageCapability(declaration, 'generate')
if (resolution.kind !== 'supported') throw new Error('Hunyuan fixture missing')
const schema = buildImageRequestParamsSchema(resolution.capability)

describe('submitted image parameters', () => {
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
