import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { afterEach, describe, expect, it, vi } from 'vitest'

const innerDoGenerate = vi.fn()
const InnerCtor = vi.fn()

vi.mock('@ai-sdk/openai-compatible', () => ({
  OpenAICompatibleImageModel: class {
    constructor(modelId: string, config: unknown) {
      InnerCtor(modelId, config)
    }
    doGenerate(options: unknown) {
      return innerDoGenerate(options)
    }
  }
}))

vi.mock('i18next', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

import { createAihubmixImageModel } from '../aihubmix/aihubmixImageModel'

/**
 * Covers the relocated AiHubMix special branches (Google native image models,
 * Ideogram V_3 FormData, Ideogram V_1/V_2 JSON/FormData), response parsing,
 * abort, error handling, and the byte-identical default delegate to the inner
 * `OpenAICompatibleImageModel`.
 */
describe('AihubmixImageModel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    innerDoGenerate.mockReset()
    InnerCtor.mockReset()
  })

  const baseURL = 'https://aihubmix.com/v1'
  const resolveApiKey = () => 'sk-test'
  const headers = () => ({ Authorization: 'Bearer sk-test', 'APP-Code': 'MLTG2087' })

  const make = (modelId: string) => createAihubmixImageModel(modelId, { baseURL, resolveApiKey, headers })

  const callOptions = (overrides: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions =>
    ({
      prompt: 'a fox',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { aihubmix: {} },
      ...overrides
    }) as ImageModelV3CallOptions

  const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('exposes a v3 ImageModel spec', () => {
    const model = make('gpt-image-1')
    expect(model.specificationVersion).toBe('v3')
    expect(model.provider).toBe('aihubmix.image')
    expect(model.modelId).toBe('gpt-image-1')
    expect(model.maxImagesPerCall).toBe(10)
  })

  describe('Google native image models', () => {
    it('routes Gemini image models through @ai-sdk/google and normalizes image config', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        okJson({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: 'image/png', data: 'AAA' } },
                  { inlineData: { mimeType: 'image/png', data: 'BBB' } }
                ]
              }
            }
          ]
        })
      )
      vi.stubGlobal('fetch', fetchMock)

      const model = make('gemini-3-pro-image-preview')
      const result = await model.doGenerate(
        callOptions({
          providerOptions: { aihubmix: { mode: 'generate', aspectRatio: 'ASPECT_16_9', imageSize: '2k' } } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent')
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('sk-test')
      const body = JSON.parse(init.body as string)
      expect(body.generationConfig.responseModalities).toEqual(['IMAGE'])
      expect(body.generationConfig.imageConfig).toMatchObject({ aspectRatio: '16:9', imageSize: '2K' })
      expect(result.images).toEqual(['AAA', 'BBB'])
    })

    it('routes Imagen models through @ai-sdk/google predict and normalizes personGeneration', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ predictions: [{ bytesBase64Encoded: 'IMG' }] }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await make('imagen-4.0-generate-preview-06-06').doGenerate(
        callOptions({
          size: '16:9' as never,
          providerOptions: { aihubmix: { personGeneration: 'ALLOW_ADULT' } } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/gemini/v1beta/models/imagen-4.0-generate-preview-06-06:predict')
      const body = JSON.parse(init.body as string)
      expect(body.parameters).toMatchObject({
        aspectRatio: '16:9',
        personGeneration: 'allow_adult',
        sampleCount: 1
      })
      expect(result.images).toEqual(['IMG'])
    })
  })

  describe('Ideogram V_3', () => {
    it('generate → FormData to /ideogram/v1/ideogram-v3/generate with Api-Key', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://img/a.png' }] }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await make('V_3').doGenerate(
        callOptions({
          n: 2,
          providerOptions: {
            aihubmix: {
              mode: 'generate',
              aspectRatio: 'ASPECT_16_9',
              renderingSpeed: 'TURBO',
              styleType: 'AUTO',
              seed: '42',
              negativePrompt: 'blur',
              magicPromptOption: true
            }
          } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/ideogram/v1/ideogram-v3/generate')
      expect((init.headers as Record<string, string>)['Api-Key']).toBe('sk-test')
      const form = init.body as FormData
      expect(form).toBeInstanceOf(FormData)
      expect(form.get('prompt')).toBe('a fox')
      expect(form.get('rendering_speed')).toBe('TURBO')
      expect(form.get('num_images')).toBe('2')
      expect(form.get('aspect_ratio')).toBe('16x9')
      expect(form.get('style_type')).toBe('AUTO')
      expect(form.get('seed')).toBe('42')
      expect(form.get('negative_prompt')).toBe('blur')
      expect(form.get('magic_prompt')).toBe('ON')
      expect(result.images).toEqual(['https://img/a.png'])
    })

    it('remix → FormData with image_weight + image blob to /ideogram/v1/ideogram-v3/remix', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://img/r.png' }] }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await make('V_3').doGenerate(
        callOptions({
          providerOptions: {
            aihubmix: {
              mode: 'remix',
              imageWeight: 55,
              imageFiles: [{ mediaType: 'image/png', data: new Uint8Array([1, 2]), name: 'src.png' }]
            }
          } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/ideogram/v1/ideogram-v3/remix')
      const form = init.body as FormData
      expect(form.get('image_weight')).toBe('55')
      expect(form.get('image')).toBeInstanceOf(Blob)
      expect(result.images).toEqual(['https://img/r.png'])
    })

    it('upscale → image_request JSON + image_file blob to /ideogram/aihubmix_image_upscale', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://img/u.png' }] }))
      vi.stubGlobal('fetch', fetchMock)

      await make('V_3').doGenerate(
        callOptions({
          prompt: '',
          providerOptions: {
            aihubmix: {
              mode: 'upscale',
              resemblance: 60,
              detail: 80,
              numImages: 1,
              imageFiles: [{ mediaType: 'image/png', data: new Uint8Array([9]), name: 'in.png' }]
            }
          } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/ideogram/aihubmix_image_upscale')
      const form = init.body as FormData
      const imageRequest = JSON.parse(form.get('image_request') as string)
      expect(imageRequest).toMatchObject({ resemblance: 60, detail: 80, num_images: 1, magic_prompt_option: 'OFF' })
      expect(form.get('image_file')).toBeInstanceOf(Blob)
    })
  })

  describe('Ideogram V_1/V_2', () => {
    it('generate → JSON {image_request} to /ideogram/aihubmix_image_generate', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://img/v1.png' }] }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await make('V_2').doGenerate(
        callOptions({
          n: 3,
          providerOptions: {
            aihubmix: {
              mode: 'generate',
              aspectRatio: 'ASPECT_1_1',
              styleType: 'REALISTIC',
              seed: '7',
              negativePrompt: 'noise',
              magicPromptOption: false
            }
          } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/ideogram/aihubmix_image_generate')
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect((init.headers as Record<string, string>)['Api-Key']).toBe('sk-test')
      const body = JSON.parse(init.body as string)
      expect(body.image_request).toMatchObject({
        prompt: 'a fox',
        model: 'V_2',
        aspect_ratio: 'ASPECT_1_1',
        num_images: 3,
        style_type: 'REALISTIC',
        seed: 7,
        negative_prompt: 'noise',
        magic_prompt_option: 'OFF'
      })
      expect(result.images).toEqual(['https://img/v1.png'])
    })

    it('remix → FormData (image_request JSON + image_file) to /ideogram/aihubmix_image_remix', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ b64_json: 'QUJD' }] }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await make('V_2').doGenerate(
        callOptions({
          providerOptions: {
            aihubmix: {
              mode: 'remix',
              imageWeight: 30,
              imageFiles: [{ mediaType: 'image/jpeg', data: new Uint8Array([3]), name: 'r.jpg' }]
            }
          } as any
        })
      )

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://aihubmix.com/ideogram/aihubmix_image_remix')
      const form = init.body as FormData
      const imageRequest = JSON.parse(form.get('image_request') as string)
      expect(imageRequest.image_weight).toBe(30)
      expect(form.get('image_file')).toBeInstanceOf(Blob)
      expect(result.images).toEqual(['data:image/png;base64,QUJD'])
    })
  })

  describe('response parsing', () => {
    it('parses data.output.b64_json[].bytesBase64', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(okJson({ output: { b64_json: [{ bytesBase64: 'OUT1' }, { bytesBase64: 'OUT2' }] } }))
      )
      const result = await make('V_2').doGenerate(callOptions())
      expect(result.images).toEqual(['data:image/png;base64,OUT1', 'data:image/png;base64,OUT2'])
    })

    it('parses data.data[].b64_json into data: URLs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [{ b64_json: 'QkJC' }] })))
      const result = await make('V_2').doGenerate(callOptions())
      expect(result.images).toEqual(['data:image/png;base64,QkJC'])
    })

    it('parses data.data[].url verbatim', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://img/x.png' }] })))
      const result = await make('V_2').doGenerate(callOptions())
      expect(result.images).toEqual(['https://img/x.png'])
    })
  })

  it('throws a REMOTE_ERROR via readErrorMessage on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    )
    await expect(make('V_2').doGenerate(callOptions())).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'bad request'
    })
  })

  it('forwards the abort signal to fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        ;(init?.signal as AbortSignal)?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const promise = make('V_2').doGenerate(callOptions({ abortSignal: controller.signal }))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  describe('default branch delegates byte-identically to the inner OpenAICompatibleImageModel', () => {
    for (const id of ['gpt-image-1', 'gpt-image-2', 'FLUX.1-Kontext-pro', 'some-unknown-model']) {
      it(`delegates ${id} forwarding the options to the inner model and returns its result unchanged`, async () => {
        const innerResult = { images: ['data:image/png;base64,DELEGATED'], warnings: [], response: {} }
        innerDoGenerate.mockResolvedValue(innerResult)

        const options = callOptions({ providerOptions: { aihubmix: { mode: 'generate', quality: 'high' } } as any })
        const result = await make(id).doGenerate(options)

        expect(InnerCtor).toHaveBeenCalledWith(id, expect.objectContaining({ provider: 'aihubmix.image', headers }))
        const ctorConfig = InnerCtor.mock.calls[0][1] as { url: (a: { path: string }) => string }
        expect(ctorConfig.url({ path: '/images/generations' })).toBe('https://aihubmix.com/v1/images/generations')
        // The default branch snake-cases the aihubmix bag before delegating, so
        // the inner model receives an equivalent (not reference-identical)
        // options object; the bag here has no rename-able keys, so it deep-equals.
        expect(innerDoGenerate).toHaveBeenCalledWith(options)
        expect(result).toBe(innerResult)
      })
    }

    it('does NOT delegate non-default ids (V_2) to the inner model', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [] })))
      await make('V_2').doGenerate(callOptions())
      expect(innerDoGenerate).not.toHaveBeenCalled()
    })
  })
})
