import type { GenerateImageParams } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { buildImageProviderOptions } from '../imageOptions'

function params(overrides: Partial<GenerateImageParams> = {}): GenerateImageParams {
  return {
    model: 'm',
    prompt: 'p',
    imageSize: '1024x1024',
    batchSize: 1,
    ...overrides
  }
}

describe('buildImageProviderOptions', () => {
  it('maps diffusion params to SiliconFlow snake_case keys for openai-compatible (silicon/zhipu resolve here)', () => {
    const result = buildImageProviderOptions(
      'openai-compatible',
      params({
        negativePrompt: 'no blur',
        seed: '42',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true,
        quality: 'hd'
      })
    )
    expect(result).toEqual({
      'openai-compatible': {
        negative_prompt: 'no blur',
        seed: 42,
        num_inference_steps: 30,
        guidance_scale: 4.5,
        prompt_enhancement: true,
        quality: 'hd'
      }
    })
  })

  it('coerces a numeric seed string to a number and drops a non-numeric seed', () => {
    expect(buildImageProviderOptions('openai-compatible', params({ seed: '-7' }))).toEqual({
      'openai-compatible': { seed: -7 }
    })
    expect(buildImageProviderOptions('openai-compatible', params({ seed: 'abc' }))).toEqual({})
  })

  it('omits empty-string and undefined values', () => {
    expect(buildImageProviderOptions('openai-compatible', params({ negativePrompt: '', quality: undefined }))).toEqual(
      {}
    )
  })

  it('for the OpenAI image family forwards only quality, under both openai and the raw id, and never seed', () => {
    const result = buildImageProviderOptions('openai-chat', params({ quality: 'high', seed: '5', negativePrompt: 'x' }))
    expect(result).toEqual({ openai: { quality: 'high' }, 'openai-chat': { quality: 'high' } })
  })

  it('maps quality/background/moderation for newapi under both openai and the newapi key', () => {
    const result = buildImageProviderOptions(
      'newapi',
      params({ quality: 'high', background: 'transparent', moderation: 'low' })
    )
    const mapped = { quality: 'high', background: 'transparent', moderation: 'low' }
    expect(result).toEqual({ openai: mapped, newapi: mapped })
  })

  it('keys cherryin under openai (OpenAIImageModel reads providerOptions.openai)', () => {
    const result = buildImageProviderOptions('cherryin', params({ quality: 'medium', background: 'opaque' }))
    const mapped = { quality: 'medium', background: 'opaque' }
    expect(result).toEqual({ openai: mapped, cherryin: mapped })
  })

  it("drops the 'auto' sentinel for openai-family (background/moderation/quality)", () => {
    expect(
      buildImageProviderOptions('newapi', params({ quality: 'auto', background: 'auto', moderation: 'auto' }))
    ).toEqual({})
    expect(buildImageProviderOptions('newapi', params({ quality: 'auto', background: 'transparent' }))).toEqual({
      openai: { background: 'transparent' },
      newapi: { background: 'transparent' }
    })
  })

  it("drops the 'auto' sentinel for the diffusion/openai-compatible branch", () => {
    expect(
      buildImageProviderOptions('openai-compatible', params({ quality: 'auto', negativePrompt: 'no blur' }))
    ).toEqual({ 'openai-compatible': { negative_prompt: 'no blur' } })
  })

  it('returns {} for the OpenAI family when no OpenAI-applicable param is set', () => {
    expect(buildImageProviderOptions('openai', params({ numInferenceSteps: 20 }))).toEqual({})
  })

  it('maps personGeneration under the google key for google providers', () => {
    const result = buildImageProviderOptions(
      'google',
      params({ personGeneration: 'allow_adult' as GenerateImageParams['personGeneration'] })
    )
    expect(result).toEqual({ google: { personGeneration: 'allow_adult' } })
  })

  it('returns {} when nothing maps (safe — preserves prior behavior, no regression)', () => {
    expect(buildImageProviderOptions('openai-compatible', params())).toEqual({})
    expect(buildImageProviderOptions('some-unknown-provider', params())).toEqual({})
  })
})
