import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AppProviderId } from '../../../../types'
import { asConcreteProviderId } from '../../../../types'
import { splitParamValues } from '../../../../utils/imageOptions'
import { resolveProviderOptionsKey } from '../../../endpoint'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import {
  DEFAULT_DIFFUSION_REGISTRATION,
  DIFFUSION_WIRE_PROFILE,
  OPENAI_COMPAT_FALLBACK_REGISTRATION,
  resolveWireRegistration,
  WIRE_REGISTRY
} from '../wireProfile'

// The engine is the single source of truth for the vendor wire; each case asserts
// the literal expected `providerOptions` bag. (These literals were locked against
// the legacy buildImageProviderOptions emitter while it still existed.)

/** Run a provider's registration (WIRE_REGISTRY, else the diffusion default) and
 *  deliver under `sdkConfig.optionsKey`, exactly as `AiService.generateImage` does —
 *  so the ids whose SDK package reads its own namespace (google-vertex → `vertex`,
 *  doubao → `bytedance`, cherryin-chat → `cherryin`) are asserted end to end. */
function engine(
  providerId: AppProviderId,
  paramValues: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const { vendorBag } = splitParamValues(paramValues)
  const registration = WIRE_REGISTRY[providerId] ?? DEFAULT_DIFFUSION_REGISTRATION
  return buildVendorProviderOptions(resolveProviderOptionsKey(providerId), paramValues, registration, vendorBag)
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
  // The `-chat`/azure/huggingface variants all read `providerOptions.openai`, so their
  // primary body collapses onto the mirror; only the ids that own a namespace get two keys.
  const OPENAI_FAMILY: AppProviderId[] = [
    'openai',
    'openai-chat',
    'azure',
    'azure-responses',
    'huggingface',
    'cherryin',
    'newapi'
  ]

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
    const body = { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    expect(engine(providerId, paramValues)).toEqual({
      openai: body,
      [resolveProviderOptionsKey(providerId)]: body
    })
  })

  it("drops 'auto'/blank and returns {} when nothing maps", () => {
    const paramValues = { quality: 'auto', background: '', numInferenceSteps: 20, cfg: 7.5 }
    expect(engine('openai', paramValues)).toEqual({})
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

describe('buildVendorProviderOptions — Ollama (numInferenceSteps → steps; size/seed are native, not profile fields)', () => {
  it('maps numInferenceSteps to steps and omits everything else', () => {
    const paramValues = { numInferenceSteps: 9, seed: 42, negativePrompt: 'no blur', quality: 'hd' }
    expect(engine('ollama', paramValues)).toEqual({ ollama: { steps: 9 } })
  })

  it('returns {} when numInferenceSteps is unset', () => {
    expect(engine('ollama', {})).toEqual({})
  })
})

/** Run a concrete provider through the generic openai-compatible path: the
 *  wire-naming fallback registration, delivered under the concrete id — the
 *  namespace `createOpenAICompatible({ name })`'s image model reads. */
function compatEngine(
  concreteId: string,
  paramValues: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const { vendorBag } = splitParamValues(paramValues)
  const registration = resolveWireRegistration('openai-compatible')
  return buildVendorProviderOptions(
    resolveProviderOptionsKey('openai-compatible', asConcreteProviderId(concreteId)),
    paramValues,
    registration,
    vendorBag
  )
}

describe('resolveWireRegistration', () => {
  it('gives the generic openai-compatible path the wire-naming fallback', () => {
    expect(resolveWireRegistration('openai-compatible')).toBe(OPENAI_COMPAT_FALLBACK_REGISTRATION)
  })

  it('keys every other path by the SDK provider id', () => {
    expect(resolveWireRegistration('openai')).toBe(WIRE_REGISTRY.openai)
    expect(resolveWireRegistration('some-unlisted-sdk')).toBe(DEFAULT_DIFFUSION_REGISTRATION)
  })
})

describe('buildVendorProviderOptions — openai-compatible fallback (wire-named passthrough)', () => {
  it('delivers under the concrete provider id with catalog wire renames (zhipu: addWatermark → watermark)', () => {
    const paramValues = { addWatermark: true, quality: 'hd', seed: 3, numImages: 1, size: '1024x1024' }
    expect(compatEngine('zhipu', paramValues)).toEqual({
      zhipu: { watermark: true, quality: 'hd', seed: 3 }
    })
  })

  it('renames imageResolution → size and keeps non-catalog bag keys as-is', () => {
    const paramValues = { imageResolution: '2K', someVendorField: 1 }
    expect(compatEngine('tokenhub', paramValues)).toEqual({
      tokenhub: { size: '2K', someVendorField: 1 }
    })
  })
})

describe('buildVendorProviderOptions — a dropped vendor bag is observable', () => {
  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
  })

  it('warns with the dropped keys when the profile maps none and passthrough is off', () => {
    // google's profile has no rule for `negativePrompt` and the registration has no
    // passthrough, so the key vanishes. Before this warning that was indistinguishable
    // from a param that reached the vendor — the #17394 failure mode.
    expect(engine('google', { negativePrompt: 'no blur', personGeneration: 'ALLOW_ALL' })).toEqual({
      google: { personGeneration: 'allow_all' }
    })

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped'),
      expect.objectContaining({ providerOptionsKey: 'google', dropped: ['negativePrompt'] })
    )
  })

  it('stays quiet for a passthrough registration, which forwards the leftovers', () => {
    expect(engine('aihubmix', { seed: 9, imageResolution: '2K' })).toEqual({
      openai: { seed: 9 },
      aihubmix: { seed: 9, imageResolution: '2K' }
    })
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })
})
