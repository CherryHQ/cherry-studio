import { describe, expect, it, vi } from 'vitest'

import { MinimaxImageModel } from '../minimax/minimaxImageModel'
import { createMinimaxProvider } from '../minimax/minimaxProvider'

describe('createMinimaxProvider', () => {
  it('uses OpenAI-compatible chat + embedding and the MiniMax image model', () => {
    const provider = createMinimaxProvider({
      apiKey: 'sk-test',
      baseURL: 'https://api.minimax.io/v1',
      fetch: vi.fn()
    })

    expect(provider.languageModel('MiniMax-M3').provider).toBe('minimax.chat')
    expect(provider.embeddingModel('embedding-model').provider).toBe('minimax.embedding')
    expect(provider.imageModel('image-01')).toBeInstanceOf(MinimaxImageModel)
    expect(provider.imageModel('image-01-live')).toBeInstanceOf(MinimaxImageModel)
  })

  it('posts the complete text-to-image request and parses URL output', async () => {
    const imageUrl = 'https://cdn.example.com/minimax.png'
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: [imageUrl] },
          metadata: { success_count: 1, failed_count: 0 },
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    const provider = createMinimaxProvider({ apiKey: 'sk-test', baseURL: 'https://api.minimax.io/v1', fetch })

    const result = await provider.imageModel('image-01').doGenerate({
      prompt: 'a lighthouse in a storm',
      n: 3,
      size: '768x1024',
      aspectRatio: '3:4',
      seed: 42,
      files: undefined,
      mask: undefined,
      providerOptions: {
        minimax: {
          response_format: 'url',
          prompt_optimizer: true,
          aigc_watermark: true
        }
      }
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/image_generation',
      expect.objectContaining({ method: 'POST' })
    )
    const sent = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).toEqual({
      model: 'image-01',
      prompt: 'a lighthouse in a storm',
      n: 3,
      width: 768,
      height: 1024,
      aspect_ratio: '3:4',
      seed: 42,
      response_format: 'url',
      prompt_optimizer: true,
      aigc_watermark: true
    })
    expect(result.images).toEqual([imageUrl])
  })

  it('parses base64 output from the China endpoint', async () => {
    const image = 'aGVsbG8='
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { image_base64: [image] }, base_resp: { status_code: 0 } }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    )
    const provider = createMinimaxProvider({ apiKey: 'sk-test', baseURL: 'https://api.minimaxi.com/v1', fetch })

    const result = await provider.imageModel('image-01-live').doGenerate({
      prompt: 'a watercolor garden',
      n: 1,
      size: undefined,
      aspectRatio: '1:1',
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: { minimax: { response_format: 'base64' } }
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/image_generation',
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.images).toEqual([image])
  })
})
