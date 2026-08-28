import { describe, expect, it, vi } from 'vitest'

import { SiliconImageModel } from '../silicon/SiliconImageModel'
import { createSiliconProvider } from '../silicon/siliconProvider'

describe('createSiliconProvider', () => {
  it('uses OpenAI-compatible chat + embedding and bespoke SiliconImageModel for image', () => {
    const provider = createSiliconProvider({
      apiKey: 'sk-test',
      baseURL: 'https://api.siliconflow.cn/v1',
      fetch: vi.fn()
    })

    expect(provider.languageModel('Qwen/Qwen3-8B').provider).toBe('silicon.chat')
    expect(provider.embeddingModel('BAAI/bge-m3').provider).toBe('silicon.embedding')
    expect(provider.imageModel('Qwen/Qwen-Image')).toBeInstanceOf(SiliconImageModel)
    expect(provider.imageModel('Kwai-Kolors/Kolors')).toBeInstanceOf(SiliconImageModel)
    expect(provider.imageModel('stable-diffusion-xl')).toBeInstanceOf(SiliconImageModel)
  })

  it('builds the SiliconFlow body with snake_case + image_size + batch_size and parses images[]', async () => {
    const imageUrl = 'https://siliconflow.cdn.example/out.png'
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          images: [{ url: imageUrl }],
          timings: { inference: 0.5 },
          seed: 42
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    const provider = createSiliconProvider({
      apiKey: 'sk-test',
      baseURL: 'https://api.siliconflow.cn/v1',
      fetch
    })
    const model = provider.imageModel('Kwai-Kolors/Kolors')

    const result = await model.doGenerate({
      prompt: 'a fox',
      n: 2,
      size: '1024x1024',
      aspectRatio: undefined,
      seed: 42,
      files: undefined,
      mask: undefined,
      providerOptions: {
        silicon: {
          negative_prompt: 'low quality',
          num_inference_steps: 25,
          guidance_scale: 4.5
        }
      }
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/images/generations',
      expect.objectContaining({ method: 'POST' })
    )
    const sent = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).toMatchObject({
      model: 'Kwai-Kolors/Kolors',
      prompt: 'a fox',
      image_size: '1024x1024',
      batch_size: 2,
      seed: 42,
      negative_prompt: 'low quality',
      num_inference_steps: 25,
      guidance_scale: 4.5
    })
    expect(sent).not.toHaveProperty('n')
    expect(sent).not.toHaveProperty('size')
    expect(result.images).toEqual([imageUrl])
  })

  it('passes Qwen-specific cfg through and attaches input files as image / image2 / image3', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ images: [{ url: 'https://x/y.png' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    )
    const provider = createSiliconProvider({ apiKey: 'sk-test', fetch })
    const model = provider.imageModel('Qwen/Qwen-Image-Edit-2509')

    await model.doGenerate({
      prompt: 'restyle these',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      mask: undefined,
      providerOptions: { silicon: { cfg: 7.5 } },
      files: [
        { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
        { type: 'url', url: 'https://x/in2.png' }
      ]
    })

    const sent = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.cfg).toBe(7.5)
    expect(sent.image).toBe(`data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`)
    expect(sent.image2).toBe('https://x/in2.png')
    expect(sent).not.toHaveProperty('image3')
    expect(sent).not.toHaveProperty('batch_size')
  })
})
