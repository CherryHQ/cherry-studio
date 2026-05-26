import { describe, expect, it, vi } from 'vitest'

import { createCherryIn } from '../cherryin-provider'
import { extractImageOutputs, OpenAIUrlImageModel } from '../openai-url-image-model'

describe('OpenAIUrlImageModel', () => {
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  it('extracts Qwen-style data[].url results', () => {
    expect(
      extractImageOutputs({
        images: [{ url: 'https://cdn.example.com/image.png' }],
        data: [{ url: 'https://cdn.example.com/image.png' }]
      })
    ).toEqual(['https://cdn.example.com/image.png'])
  })

  it('falls back to images[].url when data is absent', () => {
    expect(extractImageOutputs({ images: [{ url: 'https://cdn.example.com/from-images.png' }] })).toEqual([
      'https://cdn.example.com/from-images.png'
    ])
  })

  it('preserves standard b64_json results', () => {
    expect(extractImageOutputs({ data: [{ b64_json: 'QUJD' }] })).toEqual(['QUJD'])
  })

  it('posts to images/generations and returns URL images from the model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://cdn.example.com/a.png' }] }))
    const model = new OpenAIUrlImageModel('Qwen/Qwen-Image', {
      provider: 'silicon.image',
      url: ({ path }) => `https://api.siliconflow.cn/v1${path}`,
      headers: () => ({ Authorization: 'Bearer sk-test' }),
      fetch: fetchMock
    })

    const result = await model.doGenerate({
      prompt: 'a fox',
      n: 1,
      size: '1024x1024',
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { silicon: { negative_prompt: 'blur' } }
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.siliconflow.cn/v1/images/generations')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      model: 'Qwen/Qwen-Image',
      prompt: 'a fox',
      negative_prompt: 'blur'
    })
    expect(body).not.toHaveProperty('response_format')
    expect(result.images).toEqual(['https://cdn.example.com/a.png'])
  })

  it('CherryIN imageModel uses the URL-aware image model only for Qwen image models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ url: 'https://cdn.example.com/cherryin.png' }] }))
    const provider = createCherryIn({
      apiKey: 'sk-test',
      baseURL: 'https://open.cherryin.ai/v1',
      fetch: fetchMock
    })

    const qwenModel = provider.imageModel('Qwen/Qwen-Image')
    expect(qwenModel).toBeInstanceOf(OpenAIUrlImageModel)
    expect(provider.imageModel('gpt-image-1')).not.toBeInstanceOf(OpenAIUrlImageModel)

    const result = await qwenModel.doGenerate({
      prompt: 'a fox',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { cherryin: { quality: 'standard' } }
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.images).toEqual(['https://cdn.example.com/cherryin.png'])
  })

  it('CherryIN imageModel routes Google image models through the native Google endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ predictions: [{ bytesBase64Encoded: 'IMG' }] }))
    const provider = createCherryIn({
      apiKey: 'sk-test',
      baseURL: 'https://open.cherryin.ai/v1',
      geminiBaseURL: 'https://open.cherryin.ai/v1beta',
      fetch: fetchMock
    })

    const model = provider.imageModel('google/imagen-4.0-generate-001')
    const result = await model.doGenerate({
      prompt: 'a fox',
      n: 1,
      size: '16:9' as never,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { cherryin: { personGeneration: 'ALLOW_ADULT' } }
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.cherryin.ai/v1beta/models/google/imagen-4.0-generate-001:predict')
    expect(init.headers['x-goog-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body)
    expect(body.parameters).toMatchObject({
      aspectRatio: '16:9',
      personGeneration: 'allow_adult'
    })
    expect(result.images).toEqual(['IMG'])
  })

  it('CherryIN imageModel routes prefixed Google Gemini image models through generateContent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'GEMINI_IMG' } }]
            }
          }
        ]
      })
    )
    const provider = createCherryIn({
      apiKey: 'sk-test',
      baseURL: 'https://open.cherryin.ai/v1',
      geminiBaseURL: 'https://open.cherryin.ai/v1beta',
      fetch: fetchMock
    })

    const model = provider.imageModel('google/gemini-3-pro-image-preview')
    const result = await model.doGenerate({
      prompt: 'a fox',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { cherryin: { aspectRatio: 'ASPECT_16_9', imageSize: '2k' } }
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.cherryin.ai/v1beta/models/google/gemini-3-pro-image-preview:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body)
    expect(body.generationConfig).toMatchObject({
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' }
    })
    expect(result.images).toEqual(['GEMINI_IMG'])
  })
})
