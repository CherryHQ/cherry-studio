import { describe, expect, it } from 'vitest'

import { splitParamValues } from '../../../../utils/imageOptions'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, DIFFUSION_WIRE_PROFILE, WIRE_REGISTRY } from '../wireProfile'

// The engine is the single source of truth for the vendor wire; each case asserts
// the literal expected `providerOptions` bag. (These literals were locked against
// the legacy buildImageProviderOptions emitter while it still existed.)

/** Run a provider's registration (WIRE_REGISTRY, else the diffusion default). */
function engine(providerId: string, paramValues: Parameters<typeof buildVendorProviderOptions>[1]) {
  const { vendorBag } = splitParamValues(paramValues)
  const registration = WIRE_REGISTRY.get(providerId) ?? DEFAULT_DIFFUSION_REGISTRATION
  return buildVendorProviderOptions(providerId, paramValues, registration, vendorBag)
}

describe('image wire extension boundaries', () => {
  it.each(['constructor', '__proto__', 'toString'])(
    'uses diffusion fallback for an unregistered provider: %s',
    (providerId) => {
      const result = engine(providerId, { negativePrompt: 'avoid blur', quality: 'high' })

      expect(Object.hasOwn(result, providerId)).toBe(true)
      expect(Object.getOwnPropertyDescriptor(result, providerId)?.value).toEqual({
        negative_prompt: 'avoid blur',
        quality: 'high'
      })
    }
  )

  it('preserves native passthrough values and own reserved keys without serializing them', () => {
    const date = new Date('2026-01-02T03:04:05Z')
    const bytes = new Uint8Array([1, 2, 3])
    const nested = Object.freeze({ onProgress: () => undefined })
    const serializable = Object.freeze({
      toJSON() {
        throw new Error('Serialization belongs to the selected adapter')
      }
    })
    const vendorBag = Object.freeze({
      ['__proto__']: 'literal',
      constructor: 'constructor value',
      toString: 'toString value',
      date,
      bytes,
      nested,
      serializable,
      bigint: 42n,
      onProgress: () => undefined,
      symbol: Symbol('extension'),
      absent: undefined
    })

    const result = buildVendorProviderOptions('__proto__', {}, { profile: {}, passthrough: true }, vendorBag)
    const body = Object.getOwnPropertyDescriptor(result, '__proto__')?.value

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(body, '__proto__')?.value).toBe('literal')
    expect(body.constructor).toBe('constructor value')
    expect(body.toString).toBe('toString value')
    expect(body.date).toBe(date)
    expect(body.bytes).toBe(bytes)
    expect(body.nested).toBe(nested)
    expect(body.serializable).toBe(serializable)
    expect(body.bigint).toBe(42n)
    expect(Object.hasOwn(body, 'onProgress')).toBe(false)
    expect(Object.hasOwn(body, 'symbol')).toBe(false)
    expect(Object.hasOwn(body, 'absent')).toBe(false)
    expect(Object.hasOwn(vendorBag, 'onProgress')).toBe(true)
    expect(Object.hasOwn(vendorBag, 'symbol')).toBe(true)
    expect(Object.hasOwn(vendorBag, 'absent')).toBe(true)
  })

  it('keeps a mapped reserved wire name as an own data property', () => {
    const body = buildImageRequest({ quality: 'high' }, { fields: { quality: { to: '__proto__' } } })

    expect(Object.getOwnPropertyDescriptor(body, '__proto__')).toEqual({
      value: 'high',
      enumerable: true,
      configurable: true,
      writable: true
    })
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype)
  })

  it('merges nested contributions without losing reserved fields or mutating the source', () => {
    const contribution = Object.freeze({ imageConfig: Object.freeze({ ['__proto__']: 'literal', aspectRatio: '1:1' }) })
    const body = buildImageRequest(
      { quality: 'high', size: '1024x1024' },
      {
        fields: {
          quality: { contribute: () => contribution },
          size: { contribute: (value) => ({ imageConfig: { imageSize: value } }) }
        }
      }
    )

    expect(body).toEqual({ imageConfig: { ['__proto__']: 'literal', aspectRatio: '1:1', imageSize: '1024x1024' } })
    expect(Object.getPrototypeOf(body.imageConfig)).toBe(Object.prototype)
    expect(contribution.imageConfig).toEqual({ ['__proto__']: 'literal', aspectRatio: '1:1' })
  })
})

describe('buildVendorProviderOptions — OpenRouter image API', () => {
  it('maps model-advertised parameters under the native OpenRouter provider key', () => {
    expect(
      engine('openrouter', {
        resolution: '2K',
        quality: 'high',
        outputFormat: 'webp',
        background: 'transparent',
        outputCompression: 80,
        seed: 42,
        numImages: 2,
        aspectRatio: '16:9'
      })
    ).toEqual({
      openrouter: {
        resolution: '2K',
        quality: 'high',
        output_format: 'webp',
        background: 'transparent',
        output_compression: 80
      }
    })
  })

  it('omits output compression unless the request explicitly selects jpeg or webp', () => {
    expect(engine('openrouter', { quality: 'high', outputCompression: 0 })).toEqual({
      openrouter: { quality: 'high' }
    })
  })
})

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
  const OPENAI_FAMILY = ['openai', 'openai-chat', 'azure', 'azure-responses', 'huggingface', 'cherryin']

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

describe('buildVendorProviderOptions — New API image relay', () => {
  it('preserves OpenAI fields, diffusion fields and vendor extras under the SDK namespace', () => {
    expect(
      engine('newapi', {
        quality: 'high',
        background: 'transparent',
        moderation: 'low',
        style: 'vivid',
        negativePrompt: 'blurry',
        numInferenceSteps: 25,
        guidanceScale: 0,
        seed: 0,
        promptEnhancement: false,
        cfg: 0
      })
    ).toEqual({
      newapi: {
        quality: 'high',
        background: 'transparent',
        moderation: 'low',
        style: 'vivid',
        negative_prompt: 'blurry',
        num_inference_steps: 25,
        guidance_scale: 0,
        seed: 0,
        prompt_enhancement: false,
        cfg: 0
      }
    })
  })

  it('still omits unset mapped fields without adding defaults', () => {
    expect(engine('newapi', { quality: 'auto', background: '', negativePrompt: '' })).toEqual({})
  })
})

describe('buildVendorProviderOptions — cherryin-chat (delivers under the cherryin key, not its own id)', () => {
  it('routes the openai body under openai + cherryin (not cherryin-chat) — the AI SDK provider id AiService actually resolves for CherryIn is cherryin-chat, but its Google-image wrapper reads providerOptions.cherryin', () => {
    const paramValues = { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    expect(engine('cherryin-chat', paramValues)).toEqual({
      openai: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' },
      cherryin: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    })
  })

  it.each(['cherryin', 'cherryin-chat'])(
    'forwards personGeneration/imageResolution (not OpenAI-profile fields) under cherryin via passthrough, for %s',
    (providerId) => {
      const paramValues = { personGeneration: 'allow_adult', imageResolution: '2K', quality: 'high' }
      expect(engine(providerId, paramValues)).toEqual({
        openai: { quality: 'high' },
        cherryin: { quality: 'high', personGeneration: 'allow_adult', imageResolution: '2K' }
      })
    }
  )
})

describe('buildVendorProviderOptions — Google native image family (contribute / nested imageConfig)', () => {
  const cases: Array<[string, Parameters<typeof engine>[1], ReturnType<typeof engine>]> = [
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

  it('google-vertex reuses the google profile but delivers under the `vertex` key (@ai-sdk/google-vertex reads providerOptions.vertex, not the id)', () => {
    expect(engine('google-vertex', { aspectRatio: 'ASPECT_1_1', size: '1024x1024', numImages: 1 })).toEqual({
      vertex: { imageConfig: { aspectRatio: '1:1', imageSize: '1024x1024' } }
    })
  })

  it('delivers personGeneration under the `vertex` key for google-vertex', () => {
    expect(engine('google-vertex', { personGeneration: 'ALLOW_ALL', numImages: 1 })).toEqual({
      vertex: { personGeneration: 'allow_all' }
    })
  })

  it('maps the vendor-bag imageResolution (1K/2K/4K, what Gemini image models expose) to imageConfig.imageSize', () => {
    expect(engine('google', { imageResolution: '2K', numImages: 1 })).toEqual({
      google: { imageConfig: { imageSize: '2K' } }
    })
    expect(engine('google-vertex', { imageResolution: '2K', numImages: 1 })).toEqual({
      vertex: { imageConfig: { imageSize: '2K' } }
    })
  })

  it.each(['google', 'google-vertex'])('omits automatic imageResolution for %s', (providerId) => {
    expect(engine(providerId, { imageResolution: 'auto', numImages: 1 })).toEqual({})
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

describe('buildVendorProviderOptions — aihubmix (openai body + seed, bag forwarded under aihubmix)', () => {
  it('emits the openai fields + seed under openai + aihubmix', () => {
    const paramValues = { quality: 'high', background: 'transparent', seed: 9, numImages: 1 }
    expect(engine('aihubmix', paramValues)).toEqual({
      openai: { quality: 'high', background: 'transparent', seed: 9 },
      aihubmix: { quality: 'high', background: 'transparent', seed: 9 }
    })
  })

  it('forwards the vendor bag (doubao params) under aihubmix only, keeping openai clean', () => {
    // imageResolution / sequentialImageGeneration are non-binding canonical keys
    // (vendor bag); the per-backend custom model reads them off the aihubmix key.
    const paramValues = { seed: 9, imageResolution: '2K', sequentialImageGeneration: 'auto' }
    expect(engine('aihubmix', paramValues)).toEqual({
      openai: { seed: 9 },
      aihubmix: { seed: 9, imageResolution: '2K', sequentialImageGeneration: 'auto' }
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

describe('buildVendorProviderOptions — Ollama (numInferenceSteps → steps; size/seed are native, not profile fields)', () => {
  it('maps numInferenceSteps to steps and omits everything else', () => {
    const paramValues = { numInferenceSteps: 9, seed: 42, negativePrompt: 'no blur', quality: 'hd' }
    expect(engine('ollama', paramValues)).toEqual({ ollama: { steps: 9 } })
  })

  it('returns {} when numInferenceSteps is unset', () => {
    expect(engine('ollama', {})).toEqual({})
  })
})

describe('buildVendorProviderOptions — MiniMax image API', () => {
  it('maps output, optimizer, and watermark fields under the MiniMax key', () => {
    expect(
      engine('minimax', {
        numImages: 3,
        aspectRatio: '16:9',
        outputFormat: 'base64',
        promptEnhancement: true,
        addWatermark: true
      })
    ).toEqual({
      minimax: {
        response_format: 'base64',
        prompt_optimizer: true,
        aigc_watermark: true
      }
    })
  })
})
