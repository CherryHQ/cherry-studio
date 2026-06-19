import type { GenerateImageParams } from '@types'
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

  it('forwards registry-declared vendor-bag fields (e.g. cfg) the fixed mapping omits, skipping callbacks', () => {
    const onProgress = () => {}
    const result = buildImageProviderOptions(
      'openai-compatible',
      params({
        guidanceScale: 4.5,
        providerOptions: { 'openai-compatible': { cfg: 7.5, onProgress } }
      })
    )
    expect(result).toEqual({
      'openai-compatible': {
        cfg: 7.5,
        guidance_scale: 4.5
      }
    })
    // The non-JSON callback must not leak into the wire body.
    expect((result['openai-compatible'] as Record<string, unknown>).onProgress).toBeUndefined()
  })

  it('lets a mapped canonical param win over a same-named raw bag field', () => {
    const result = buildImageProviderOptions(
      'openai-compatible',
      params({ negativePrompt: 'mapped', providerOptions: { 'openai-compatible': { negative_prompt: 'bag' } } })
    )
    expect(result).toEqual({ 'openai-compatible': { negative_prompt: 'mapped' } })
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

  it('maps personGeneration + imageSize (as imageConfig.imageSize) under the google key', () => {
    const result = buildImageProviderOptions(
      'google',
      params({ personGeneration: 'allow_adult' as GenerateImageParams['personGeneration'] })
    )
    expect(result).toEqual({
      google: { imageConfig: { imageSize: '1024x1024' }, personGeneration: 'allow_adult' }
    })
  })

  it('maps a normalized aspectRatio + imageSize into google.imageConfig', () => {
    const result = buildImageProviderOptions('google', params({ aspectRatio: 'ASPECT_16_9', imageSize: '2048x2048' }))
    expect(result).toEqual({ google: { imageConfig: { aspectRatio: '16:9', imageSize: '2048x2048' } } })
  })

  it('lowercases the registry-uppercase personGeneration for the @ai-sdk/google schema', () => {
    const result = buildImageProviderOptions(
      'google',
      params({ imageSize: undefined, personGeneration: 'ALLOW_ALL' as GenerateImageParams['personGeneration'] })
    )
    expect(result).toEqual({ google: { personGeneration: 'allow_all' } })
  })

  it('returns {} when nothing maps (safe — preserves prior behavior, no regression)', () => {
    expect(buildImageProviderOptions('openai-compatible', params())).toEqual({})
    expect(buildImageProviderOptions('some-unknown-provider', params())).toEqual({})
  })

  it('dmxapi dual-keys: snake_case under dmxapi + imageResolution/aspectRatio into google.imageConfig', () => {
    const result = buildImageProviderOptions(
      'dmxapi',
      params({
        negativePrompt: 'no blur',
        seed: '7',
        aspectRatio: 'ASPECT_1_1',
        providerOptions: { dmxapi: { imageResolution: '4K' } }
      })
    )
    expect(result).toEqual({
      dmxapi: { negative_prompt: 'no blur', seed: 7 },
      google: { imageConfig: { aspectRatio: '1:1', imageSize: '4K' } }
    })
  })

  it('dmxapi omits the google bag when no aspectRatio / imageResolution is set', () => {
    const result = buildImageProviderOptions('dmxapi', params({ negativePrompt: 'x' }))
    expect(result).toEqual({ dmxapi: { negative_prompt: 'x' } })
  })

  it('dashscope forwards the vendor bag (modelDescriptor / langs) the submit transport needs, mapped fields winning', () => {
    // Regression: without bag-forwarding, modelDescriptor is dropped and
    // dashscopeTransport.submit throws "Missing modelDescriptor".
    const result = buildImageProviderOptions(
      'dashscope',
      params({
        negativePrompt: 'no blur',
        seed: '42',
        providerOptions: {
          dashscope: {
            modelDescriptor: { id: 'qwen-mt-image', endpoint: '/api/v1/services/aigc/image', isSync: false },
            sourceLang: 'auto',
            negative_prompt: 'bag-loses'
          }
        }
      })
    )
    expect(result).toEqual({
      dashscope: {
        modelDescriptor: { id: 'qwen-mt-image', endpoint: '/api/v1/services/aigc/image', isSync: false },
        sourceLang: 'auto',
        negative_prompt: 'no blur',
        seed: 42
      }
    })
  })
})
