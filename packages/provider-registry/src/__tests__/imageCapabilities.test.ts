import { describe, expect, it } from 'vitest'

import alibaba from '../creators/alibaba'
import aihubmix from '../providers/aihubmix'
import tokenhub from '../providers/tokenhub'
import { resolveImageCapability, resolveImageGenerationSupport } from '../utils/imageCapabilities'

describe('image capability selection from authored provider contracts', () => {
  it('keeps an image-only model under ordinary generation and does not invent standalone operations', () => {
    const row = aihubmix.overrides?.find((entry) => entry.modelId === 'qwen-image-edit')
    if (!row) throw new Error('Missing Qwen edit declaration')
    const support = resolveImageGenerationSupport(
      alibaba.models?.find((entry) => entry.id === row.modelId) ?? null,
      row
    )
    expect(resolveImageCapability(support, 'generate', false)).toMatchObject({
      kind: 'supported',
      capability: { inputs: { images: { min: 1, max: { kind: 'unknown' } } } }
    })
    expect(resolveImageCapability(support, 'upscale', true)).toEqual({ kind: 'unsupported' })
  })

  // Retrieved 2026-09-09: https://cloud.tencent.com/document/product/1823/135745
  // https://cloud.tencent.com/document/product/1823/136609; https://cloud.tencent.com/document/product/1823/135746
  it.each([
    ['hy-image-v3', 3],
    ['seedream-image-v5.0-pro', 10],
    ['seedream-image-v5.0-lite', 14],
    ['vidu-image-q2', 7]
  ] as const)('accepts optional references without an edit operation on %s', (apiModelId, max) => {
    const row = tokenhub.overrides?.find((entry) => entry.apiModelId === apiModelId)
    if (!row) throw new Error('Missing TokenHub declaration')
    const support = resolveImageGenerationSupport(null, row)
    for (const hasImages of [false, true])
      expect(resolveImageCapability(support, 'generate', hasImages)).toMatchObject({
        kind: 'supported',
        capability: { inputs: { images: { min: 0, max: { kind: 'known', value: max } }, prompt: 'required' } }
      })
  })

  it('distinguishes missing configuration from an explicitly disabled operation', () => {
    expect(resolveImageCapability(undefined, 'generate', false)).toEqual({ kind: 'unconfigured' })
    const row = tokenhub.overrides?.find((entry) => entry.apiModelId === 'hy-image-v3')
    if (!row) throw new Error('Missing TokenHub declaration')
    const base = resolveImageGenerationSupport(null, row)
    const support = resolveImageGenerationSupport(
      { imageGeneration: base },
      { imageGeneration: { operations: { generate: null } } }
    )
    expect(resolveImageCapability(support, 'generate', true)).toEqual({ kind: 'unsupported' })
  })
})
