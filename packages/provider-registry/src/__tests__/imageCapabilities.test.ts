import { describe, expect, it } from 'vitest'

import alibaba from '../creators/alibaba'
import aihubmix from '../providers/aihubmix'
import tokenhub from '../providers/tokenhub'
import { ImageGenerationSupportSchema } from '../schemas/model'
import { buildParamsSchema } from '../utils/buildParamsSchema'
import { resolveImageGenerationSupport, resolveLegacyImageCapability } from '../utils/imageCapabilities'

describe('image capability selection', () => {
  it('rejects an undeclared operation instead of validating against the first declaration', () => {
    const support = ImageGenerationSupportSchema.parse({
      modes: { edit: { supports: { seed: { type: 'text' } } } }
    })

    expect(buildParamsSchema(support, 'generate').safeParse({ seed: 0 }).success).toBe(false)
    expect(buildParamsSchema(support, 'upscale').safeParse({ seed: 0 }).success).toBe(false)
    expect(buildParamsSchema(support, 'edit').parse({ seed: 0 })).toMatchObject({ seed: 0 })
  })

  it('distinguishes missing capability data from an explicitly absent operation', () => {
    expect(resolveLegacyImageCapability(undefined, 'generate')).toEqual({ kind: 'unconfigured' })
    expect(resolveLegacyImageCapability({ modes: {} }, 'generate')).toEqual({ kind: 'unsupported' })
  })

  // Retrieved 2026-09-09: https://cloud.tencent.com/document/product/1823/135745
  // https://cloud.tencent.com/document/product/1823/136609; https://cloud.tencent.com/document/product/1823/135746
  it.each([
    ['hy-image-v3', 3],
    ['seedream-image-v5.0-pro', 10],
    ['seedream-image-v5.0-lite', 14],
    ['vidu-image-q2', 7]
  ] as const)('keeps optional references independent of edit on %s', (apiModelId, max) => {
    const row = tokenhub.overrides?.find((entry) => entry.apiModelId === apiModelId)
    const support = ImageGenerationSupportSchema.parse(row?.imageGeneration)
    expect(resolveLegacyImageCapability(support, 'generate')).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 0, max: { kind: 'known', value: max } }, prompt: 'required' } }
    })
    expect(resolveLegacyImageCapability(support, 'edit')).toEqual({ kind: 'unsupported' })
  })

  it('does not invent a maximum for the legacy Qwen edit declaration', () => {
    const row = aihubmix.overrides?.find((entry) => entry.modelId === 'qwen-image-edit')
    const support = ImageGenerationSupportSchema.parse(row?.imageGeneration)
    expect(resolveLegacyImageCapability(support, 'edit')).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 1, max: { kind: 'unknown' } } } }
    })
  })

  it('uses the provider declaration without inheriting creator constraints', () => {
    const model = alibaba.models?.find((entry) => entry.id === 'qwen-image')
    const override = aihubmix.overrides?.find((entry) => entry.modelId === 'qwen-image')
    if (!model || !override) throw new Error('Qwen producer fixture missing')

    const support = resolveImageGenerationSupport(model, override)
    expect(support).toEqual(override.imageGeneration)
    expect(support).not.toEqual(model.imageGeneration)
    expect(resolveImageGenerationSupport(model, null)).toEqual(model.imageGeneration)
    expect(resolveImageGenerationSupport(null, override)).toEqual(override.imageGeneration)
  })

  it('preserves an explicit empty override rather than re-enabling creator capabilities', () => {
    const model = { imageGeneration: ImageGenerationSupportSchema.parse({ modes: { generate: { supports: {} } } }) }
    expect(resolveImageGenerationSupport(model, { imageGeneration: { modes: {} } })).toEqual({ modes: {} })
    expect(resolveImageGenerationSupport(null, null)).toBeUndefined()
  })

  it('preserves an explicitly optional prompt without applying parameter defaults', () => {
    const support = ImageGenerationSupportSchema.parse({
      modes: { upscale: { requirePrompt: false, supports: { seed: { type: 'range', min: 0, max: 10, default: 5 } } } }
    })
    expect(resolveLegacyImageCapability(support, 'upscale')).toMatchObject({
      kind: 'supported',
      capability: { inputs: { prompt: 'optional' } }
    })
    expect(buildParamsSchema(support, 'upscale').parse({}).seed).toBeUndefined()
  })
})
