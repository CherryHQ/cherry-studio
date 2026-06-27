import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../../../../utils/imageOptions'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, DIFFUSION_WIRE_PROFILE, WIRE_REGISTRY } from '../wireProfile'

// The engine is the single source of truth for the vendor wire; each case asserts
// the literal expected `providerOptions` bag. (These literals were locked against
// the legacy buildImageProviderOptions emitter while it still existed.)

/** Run a provider's registration (WIRE_REGISTRY, else the diffusion default). */
function engine(providerId: string, paramValues: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const { vendorBag } = splitParamValues(paramValues)
  const registration = WIRE_REGISTRY[providerId] ?? DEFAULT_DIFFUSION_REGISTRATION
  return buildVendorProviderOptions(providerId, paramValues, registration, vendorBag)
}

describe('buildVendorProviderOptions — diffusion family (passthrough)', () => {
  it('maps the snake_case sampling fields and forwards cfg via passthrough', () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 42,
      negativePrompt: 'low quality',
      numInferenceSteps: 25,
      guidanceScale: 4.5,
      cfg: 7.5 // vendor-bag field → forwarded by passthrough, not the profile
    }
    const result = engine('silicon', paramValues)
    expect(result).toEqual({
      silicon: { negative_prompt: 'low quality', seed: 42, num_inference_steps: 25, guidance_scale: 4.5, cfg: 7.5 }
    })
    // native params (n/size) are not in the vendor body
    expect(result.silicon).not.toHaveProperty('n')
    expect(result.silicon).not.toHaveProperty('size')
  })

  it("drops 'auto'/blank mapped fields, forwards the bag", () => {
    const paramValues = { quality: 'auto', negativePrompt: '', cfg: 7.5, promptEnhancement: true }
    expect(engine('silicon', paramValues)).toEqual({ silicon: { cfg: 7.5, prompt_enhancement: true } })
  })

  it('serves an unlisted provider as the catch-all (== legacy diffusion fallback)', () => {
    const paramValues = { seed: 9, numInferenceSteps: 30, addWatermark: true, cfg: 3 }
    expect(engine('some-unlisted-provider', paramValues)).toEqual({
      'some-unlisted-provider': { seed: 9, num_inference_steps: 30, addWatermark: true, cfg: 3 }
    })
  })

  it('returns {} for the empty case', () => {
    expect(engine('silicon', {})).toEqual({})
  })

  it('maps only the profile fields when passthrough is off', () => {
    const paramValues = { negativePrompt: 'x', seed: 1, cfg: 7.5 }
    // raw engine body (no passthrough): cfg is dropped, only profile fields map
    expect(buildImageRequest(paramValues, DIFFUSION_WIRE_PROFILE)).toEqual({ negative_prompt: 'x', seed: 1 })
  })
})

describe('buildVendorProviderOptions — OpenAI image family (dual-keyed)', () => {
  const OPENAI_FAMILY = ['openai', 'openai-chat', 'azure', 'azure-responses', 'huggingface', 'cherryin', 'newapi']

  it.each(OPENAI_FAMILY)('dual-keys the openai body under openai + %s, dropping seed', (providerId) => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 7, // OpenAI family drops seed from the body — must not appear
      quality: 'high',
      background: 'transparent',
      moderation: 'low',
      style: 'vivid'
    }
    expect(engine(providerId, paramValues)).toEqual({
      openai: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' },
      [providerId]: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    })
  })

  it("drops 'auto'/blank and returns {} when nothing maps", () => {
    const paramValues = { quality: 'auto', background: '', numInferenceSteps: 20, cfg: 7.5 }
    expect(engine('openai', paramValues)).toEqual({})
  })
})

describe('buildVendorProviderOptions — Google native image family (contribute / nested imageConfig)', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, Record<string, unknown>>]> = [
    [
      'personGeneration + imageSize',
      { personGeneration: 'allow_adult', size: '1024x1024', numImages: 1 },
      { google: { imageConfig: { imageSize: '1024x1024' }, personGeneration: 'allow_adult' } }
    ],
    [
      'normalized aspectRatio + imageSize into imageConfig',
      { aspectRatio: 'ASPECT_16_9', size: '2048x2048', numImages: 1 },
      { google: { imageConfig: { aspectRatio: '16:9', imageSize: '2048x2048' } } }
    ],
    [
      'lowercases registry-uppercase personGeneration, no imageConfig when size unset',
      { personGeneration: 'ALLOW_ALL', numImages: 1 },
      { google: { personGeneration: 'allow_all' } }
    ]
  ]

  it.each(cases)('reproduces the google emitter: %s', (_label, paramValues, expected) => {
    expect(engine('google', paramValues)).toEqual(expected)
  })

  it('drops an invalid aspectRatio so no empty imageConfig survives', () => {
    expect(engine('google', { aspectRatio: 'weird', numImages: 1 })).toEqual({})
  })

  it('google-vertex shares the same profile', () => {
    expect(engine('google-vertex', { aspectRatio: 'ASPECT_1_1', size: '1024x1024', numImages: 1 })).toEqual({
      'google-vertex': { imageConfig: { aspectRatio: '1:1', imageSize: '1024x1024' } }
    })
  })
})

describe('buildVendorProviderOptions — DashScope (passthrough, mapped wins)', () => {
  it('forwards the vendor bag (modelDescriptor / langs), mapped fields winning, auto preserved', () => {
    const paramValues = {
      negativePrompt: 'no blur',
      seed: 42,
      numImages: 1,
      modelDescriptor: { id: 'qwen-mt-image', endpoint: '/api/v1/services/aigc/image', isSync: false },
      sourceLang: 'auto', // a bag value of 'auto' must survive (jsonBag doesn't compact)
      negative_prompt: 'bag-loses' // colliding bag entry — mapped negativePrompt overrides it
    }
    expect(engine('dashscope', paramValues)).toEqual({
      dashscope: {
        modelDescriptor: { id: 'qwen-mt-image', endpoint: '/api/v1/services/aigc/image', isSync: false },
        sourceLang: 'auto',
        negative_prompt: 'no blur',
        seed: 42
      }
    })
  })

  it('maps style and returns {} when nothing maps and the bag is empty', () => {
    expect(engine('dashscope', { style: 'watercolor', numImages: 1 })).toEqual({ dashscope: { style: 'watercolor' } })
    expect(engine('dashscope', {})).toEqual({})
  })
})

describe('buildVendorProviderOptions — aihubmix (openai body + seed, dual-keyed)', () => {
  it('emits the openai fields + seed under openai + aihubmix', () => {
    const paramValues = { quality: 'high', background: 'transparent', seed: 9, numImages: 1 }
    expect(engine('aihubmix', paramValues)).toEqual({
      openai: { quality: 'high', background: 'transparent', seed: 9 },
      aihubmix: { quality: 'high', background: 'transparent', seed: 9 }
    })
  })
})

describe('buildVendorProviderOptions — dmxapi (cross-key: dmxapi body + google.imageConfig via `also`)', () => {
  it('dual-keys snake_case under dmxapi + imageResolution/aspectRatio into google.imageConfig', () => {
    const paramValues = {
      negativePrompt: 'no blur',
      seed: 7,
      aspectRatio: 'ASPECT_1_1',
      imageResolution: '4K',
      numImages: 1
    }
    expect(engine('dmxapi', paramValues)).toEqual({
      dmxapi: { negative_prompt: 'no blur', seed: 7 },
      google: { imageConfig: { aspectRatio: '1:1', imageSize: '4K' } }
    })
  })

  it('omits the google sibling key when no aspectRatio / imageResolution is set', () => {
    expect(engine('dmxapi', { negativePrompt: 'x', numImages: 1 })).toEqual({ dmxapi: { negative_prompt: 'x' } })
  })
})
