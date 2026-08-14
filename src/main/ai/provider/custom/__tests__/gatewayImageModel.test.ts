import type { ImageModelV3CallOptions, LanguageModelV3 } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const callOptions = (overrides: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions =>
  ({
    prompt: 'a fox',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    ...overrides
  }) as ImageModelV3CallOptions

/** Minimal LanguageModelV3 whose doGenerate returns a single image file part. */
const fakeLanguageModel = (doGenerate: ReturnType<typeof vi.fn>): LanguageModelV3 =>
  ({ doGenerate }) as unknown as LanguageModelV3

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

  it('routes gemini image ids through the language→image adapter, not the gateway image route', () => {
    languageModel.mockReturnValue(fakeLanguageModel(vi.fn()))
    const provider = createGatewayWithImageModel({})

    const model = provider.imageModel('google/gemini-3-pro-image')

    expect(languageModel).toHaveBeenCalledWith('google/gemini-3-pro-image')
    expect(baseImageModel).not.toHaveBeenCalled()
    expect(model.modelId).toBe('google/gemini-3-pro-image')
  })

  it('delegates non-gemini image ids to the native gateway image model', () => {
    baseImageModel.mockReturnValue({ modelId: 'openai/gpt-image-1' })
    const provider = createGatewayWithImageModel({})

    provider.imageModel('openai/gpt-image-1')

    expect(baseImageModel).toHaveBeenCalledWith('openai/gpt-image-1')
    expect(languageModel).not.toHaveBeenCalled()
  })

  it('also overrides the `image` alias so it does not hit the old route', () => {
    languageModel.mockReturnValue(fakeLanguageModel(vi.fn()))
    const provider = createGatewayWithImageModel({})

    const model = provider.image('google/gemini-3-pro-image')

    expect(languageModel).toHaveBeenCalledWith('google/gemini-3-pro-image')
    expect(baseImageModel).not.toHaveBeenCalled()
    expect(model.modelId).toBe('google/gemini-3-pro-image')
  })
})
