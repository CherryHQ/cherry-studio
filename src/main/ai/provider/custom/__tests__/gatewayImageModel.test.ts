import type { ImageModelV3CallOptions, LanguageModelV3 } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { splitParamValues } from '../../../utils/imageOptions'
import { buildVendorProviderOptions } from '../wire/buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION } from '../wire/wireProfile'

const baseImageModel = vi.fn()
const languageModel = vi.fn()

vi.mock('@ai-sdk/gateway', () => ({
  // Mirror the real provider: `image` is aliased to `imageModel` at creation.
  createGateway: vi.fn(() => ({
    image: baseImageModel,
    imageModel: baseImageModel,
    languageModel
  }))
}))

import { createGatewayGeminiImageModel, isGatewayGeminiImageModel } from '../gateway/gatewayImageModel'
import { createGatewayWithImageModel } from '../gateway/gatewayProvider'

const callOptions = (overrides: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions => ({
  prompt: 'a fox',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {},
  ...overrides
})

/** Minimal LanguageModelV3 whose doGenerate returns a single image file part. */
const fakeLanguageModel = (doGenerate: ReturnType<typeof vi.fn<(...args: any[]) => any>>): LanguageModelV3 =>
  ({ doGenerate }) as unknown as LanguageModelV3

const gatewayProviderOptions = (paramValues: Record<string, unknown>) => {
  const { vendorBag } = splitParamValues(paramValues)
  return buildVendorProviderOptions('gateway', paramValues, DEFAULT_DIFFUSION_REGISTRATION, vendorBag)
}

describe('isGatewayGeminiImageModel', () => {
  it('matches gemini chat-image ids (with or without google/ prefix)', () => {
    expect(isGatewayGeminiImageModel('google/gemini-3-pro-image')).toBe(true)
    expect(isGatewayGeminiImageModel('gemini-2.5-flash-image')).toBe(true)
  })

  it('rejects non-image gemini and dedicated image models', () => {
    expect(isGatewayGeminiImageModel('google/gemini-3-pro-preview')).toBe(false)
    expect(isGatewayGeminiImageModel('imagen-4')).toBe(false)
    expect(isGatewayGeminiImageModel('google/gpt-image-1')).toBe(false)
  })
})

describe('createGatewayGeminiImageModel', () => {
  it('drives the language API with responseModalities IMAGE and returns the image', async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: 'file', mediaType: 'image/png', data: 'BASE64DATA' }],
      finishReason: 'stop',
      usage: {},
      response: { headers: {} }
    })
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'google/gemini-3-pro-image')

    const result = await model.doGenerate(callOptions({ prompt: 'a fox' }))

    expect(result.images).toEqual(['BASE64DATA'])
    const sent = doGenerate.mock.calls[0][0]
    expect(sent.providerOptions.google.responseModalities).toEqual(['IMAGE'])
    expect(sent.prompt).toEqual([{ role: 'user', content: [{ type: 'text', text: 'a fox' }] }])
  })

  it('maps aspectRatio onto google.imageConfig', async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: 'file', mediaType: 'image/png', data: 'IMG' }],
      finishReason: 'stop',
      usage: {},
      response: { headers: {} }
    })
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'gemini-2.5-flash-image')

    await model.doGenerate(callOptions({ aspectRatio: '16:9' }))

    expect(doGenerate.mock.calls[0][0].providerOptions.google.imageConfig).toEqual({ aspectRatio: '16:9' })
  })

  it('moves the inherited Gateway resolution into google.imageConfig without dropping routing options', async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: 'file', mediaType: 'image/png', data: 'IMG' }],
      finishReason: 'stop',
      usage: {},
      response: { headers: {} }
    })
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'google/gemini-3.1-flash-image')
    const providerOptions = gatewayProviderOptions({ imageResolution: '2K' })
    providerOptions.gateway.only = ['google']

    await model.doGenerate(callOptions({ providerOptions }))

    const sent = doGenerate.mock.calls[0][0]
    expect(sent.providerOptions.gateway).toEqual({ only: ['google'] })
    expect(sent.providerOptions.google.imageConfig).toEqual({ imageSize: '2K' })
  })

  it('preserves other provider options and deep-merges existing imageConfig', async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: 'file', mediaType: 'image/png', data: 'IMG' }],
      finishReason: 'stop',
      usage: {},
      response: { headers: {} }
    })
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'google/gemini-3-pro-image')

    await model.doGenerate(
      callOptions({
        aspectRatio: '16:9',
        providerOptions: { gateway: { only: ['google'] }, google: { imageConfig: { imageSize: '2K' } } }
      })
    )

    const sent = doGenerate.mock.calls[0][0]
    // gateway routing options must survive
    expect(sent.providerOptions.gateway).toEqual({ only: ['google'] })
    // existing imageSize is kept while aspectRatio is added
    expect(sent.providerOptions.google.imageConfig).toEqual({ imageSize: '2K', aspectRatio: '16:9' })
    expect(sent.providerOptions.google.responseModalities).toEqual(['IMAGE'])
  })

  it('rejects mask-based editing instead of silently ignoring it', async () => {
    const doGenerate = vi.fn()
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'google/gemini-3-pro-image')

    await expect(
      model.doGenerate(callOptions({ mask: { type: 'file', mediaType: 'image/png', data: 'MASK' } }))
    ).rejects.toThrow(/mask/i)
    expect(doGenerate).not.toHaveBeenCalled()
  })

  it('forwards input images as file parts and ignores non-image content', async () => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'here you go' },
        { type: 'file', mediaType: 'image/jpeg', data: 'EDITED' }
      ],
      finishReason: 'stop',
      usage: {},
      response: { headers: {} }
    })
    const model = createGatewayGeminiImageModel(fakeLanguageModel(doGenerate), 'google/gemini-3-pro-image')

    const result = await model.doGenerate(
      callOptions({ prompt: 'add a hat', files: [{ type: 'file', mediaType: 'image/png', data: 'INPUT' }] })
    )

    expect(result.images).toEqual(['EDITED'])
    const content = doGenerate.mock.calls[0][0].prompt[0].content
    expect(content).toContainEqual({ type: 'file', mediaType: 'image/png', data: 'INPUT' })
  })
})

describe('createGatewayWithImageModel', () => {
  afterEach(() => {
    baseImageModel.mockReset()
    languageModel.mockReset()
  })

  it.each([
    'google/gemini-3-pro-image',
    'gemini-2.5-flash-image',
    'google/gemini-nano-banana-2.1',
    'gemini-nano-banana-2.1',
    'google/nano-banana-pro-preview',
    'nano-banana-pro-preview'
  ])('generates images from %s through both Gateway image entry points', async (modelId) => {
    const doGenerate = vi.fn().mockResolvedValue({
      content: [{ type: 'file', mediaType: 'image/png', data: 'AQID' }]
    })
    languageModel.mockReturnValue(fakeLanguageModel(doGenerate))
    const provider = createGatewayWithImageModel({})

    for (const entryPoint of ['imageModel', 'image'] as const) {
      const model = provider[entryPoint](modelId)
      const result = await model.doGenerate(
        callOptions({ aspectRatio: '16:9', providerOptions: gatewayProviderOptions({ imageResolution: '2K' }) })
      )

      expect(model.modelId).toBe(modelId)
      expect(result.images).toEqual(['AQID'])
      expect(languageModel).toHaveBeenLastCalledWith(modelId)
      expect(doGenerate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'a fox' }] }],
          providerOptions: {
            google: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K', aspectRatio: '16:9' } }
          }
        })
      )
    }
    expect(baseImageModel).not.toHaveBeenCalled()
  })

  it.each(['openai/gpt-image-1', 'google/imagen-4.0-generate-001'])(
    'keeps %s generation on the native Gateway image route',
    async (modelId) => {
      const doGenerate = vi.fn().mockResolvedValue({ images: ['NATIVE_IMAGE'] })
      baseImageModel.mockReturnValue({ modelId, doGenerate })
      const provider = createGatewayWithImageModel({})

      for (const entryPoint of ['imageModel', 'image'] as const) {
        const result = await provider[entryPoint](modelId).doGenerate(callOptions())

        expect(result.images).toEqual(['NATIVE_IMAGE'])
        expect(baseImageModel).toHaveBeenLastCalledWith(modelId)
        expect(doGenerate).toHaveBeenLastCalledWith(callOptions())
      }
      expect(languageModel).not.toHaveBeenCalled()
    }
  )
})
