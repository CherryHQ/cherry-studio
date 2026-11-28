import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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

describe('buildVendorProviderOptions — OpenAI-compatible generic adapter', () => {
  function buildCompatOptions(deliveryKey: string, paramValues: Record<string, unknown>) {
    const { structured, vendorBag } = splitParamValues(paramValues)
    const registration = WIRE_REGISTRY['openai-compatible'] ?? DEFAULT_DIFFUSION_REGISTRATION
    return {
      structured,
      providerOptions: buildVendorProviderOptions(deliveryKey, paramValues, registration, vendorBag)
    }
  }

  it('maps OpenAI image fields to snake_case alongside diffusion fields and passthrough extras', () => {
    const { providerOptions } = buildCompatOptions('custom-relay', {
      numImages: 2,
      size: '1024x1536',
      quality: 'high',
      background: 'transparent',
      moderation: 'low',
      style: 'vivid',
      complexity: 'low',
      outputFormat: 'webp',
      seed: 42,
      negativePrompt: 'blurry',
      numInferenceSteps: 25,
      guidanceScale: 4.5,
      promptEnhancement: false,
      cfg: 7.5
    })

    expect(providerOptions).toEqual({
      'custom-relay': {
        quality: 'high',
        background: 'transparent',
        moderation: 'low',
        style: 'vivid',
        complexity: 'low',
        output_format: 'webp',
        seed: 42,
        negative_prompt: 'blurry',
        num_inference_steps: 25,
        guidance_scale: 4.5,
        prompt_enhancement: false,
        cfg: 7.5
      }
    })
    expect(providerOptions['custom-relay']).not.toHaveProperty('outputFormat')
    expect(providerOptions['custom-relay']).not.toHaveProperty('n')
    expect(providerOptions['custom-relay']).not.toHaveProperty('size')
    expect(providerOptions).not.toHaveProperty('openai-compatible')
  })

  it('sends snake_case vendor params and seed in the /images/generations JSON body via @ai-sdk/openai-compatible', async () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1536',
      quality: 'high',
      background: 'transparent',
      moderation: 'low',
      outputFormat: 'webp',
      seed: 42,
      cfg: 7.5
    }
    const { structured, providerOptions } = buildCompatOptions('custom-relay', paramValues)

    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const model = createOpenAICompatible({
      baseURL: 'https://custom-relay.example/v1',
      apiKey: 'test-key',
      name: 'custom-relay',
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>
        })
        return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
          headers: { 'content-type': 'application/json' }
        })
      }
    }).imageModel('gpt-image-1')

    await model.doGenerate({
      prompt: 'a fox',
      n: structured.n ?? 1,
      size: structured.size as `${number}x${number}`,
      aspectRatio: undefined,
      seed: structured.seed,
      files: undefined,
      mask: undefined,
      providerOptions
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://custom-relay.example/v1/images/generations')
    expect(requests[0].body).toEqual({
      model: 'gpt-image-1',
      prompt: 'a fox',
      n: 2,
      size: '1024x1536',
      quality: 'high',
      background: 'transparent',
      moderation: 'low',
      output_format: 'webp',
      seed: 42,
      cfg: 7.5
    })
    expect(requests[0].body).not.toHaveProperty('outputFormat')
  })

  it('sends snake_case vendor params and seed in the /images/edits FormData body without auto values via @ai-sdk/openai-compatible', async () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1536',
      quality: 'auto',
      background: 'auto',
      moderation: 'low',
      outputFormat: 'webp',
      seed: 42,
      cfg: 7.5
    }
    const { structured, providerOptions } = buildCompatOptions('custom-relay', paramValues)

    const requests: Array<{ url: string; body: FormData }> = []
    const model = createOpenAICompatible({
      baseURL: 'https://custom-relay.example/v1',
      apiKey: 'test-key',
      name: 'custom-relay',
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: init?.body as FormData
        })
        return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
          headers: { 'content-type': 'application/json' }
        })
      }
    }).imageModel('gpt-image-1')

    await model.doGenerate({
      prompt: 'a fox',
      n: structured.n ?? 1,
      size: structured.size as `${number}x${number}`,
      aspectRatio: undefined,
      seed: structured.seed,
      files: [{ type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }],
      mask: undefined,
      providerOptions
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://custom-relay.example/v1/images/edits')
    expect(requests[0].body).toBeInstanceOf(FormData)

    const form = requests[0].body
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('a fox')
    expect(form.get('n')).toBe('2')
    expect(form.get('size')).toBe('1024x1536')
    expect(form.get('image')).toBeInstanceOf(Blob)
    expect(form.get('moderation')).toBe('low')
    expect(form.get('output_format')).toBe('webp')
    expect(form.has('outputFormat')).toBe(false)
    expect(form.get('seed')).toBe('42')
    expect(form.get('cfg')).toBe('7.5')
    expect(form.has('quality')).toBe(false)
    expect(form.has('background')).toBe(false)
    expect(Array.from(form.values())).not.toContain('auto')
  })

  it("drops 'auto' and unset fields instead of leaking them via passthrough, while keeping falsy values", () => {
    expect(
      buildCompatOptions('custom-relay', {
        quality: 'auto',
        background: 'auto',
        moderation: 'auto',
        style: 'auto',
        complexity: 'auto',
        outputFormat: 'auto',
        negativePrompt: '',
        seed: undefined
      }).providerOptions
    ).toEqual({})

    expect(
      buildCompatOptions('custom-relay', {
        seed: 0,
        guidanceScale: 0,
        promptEnhancement: false,
        cfg: 0
      }).providerOptions
    ).toEqual({
      'custom-relay': {
        seed: 0,
        guidance_scale: 0,
        prompt_enhancement: false,
        cfg: 0
      }
    })
  })
})
