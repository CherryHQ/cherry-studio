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

  it('uploads image inputs as MiniMax character subject references', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { image_urls: ['https://cdn.example.com/result.png'] },
          base_resp: { status_code: 0, status_msg: 'success' }
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    const provider = createMinimaxProvider({ apiKey: 'sk-test', baseURL: 'https://api.minimaxi.com/v1', fetch })

    await provider.imageModel('image-01').doGenerate({
      prompt: 'keep both characters',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: [
        { type: 'url', url: 'https://cdn.example.com/character.jpg' },
        { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }
      ],
      mask: undefined,
      providerOptions: {}
    })

    const sent = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.subject_reference).toEqual([
      { type: 'character', image_file: 'https://cdn.example.com/character.jpg' },
      { type: 'character', image_file: 'data:image/png;base64,AQID' }
    ])
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

  it.each([
    ['https://api.minimax.io/v1', 'https://api.minimax.io/v1/voice_design'],
    ['https://api.minimaxi.com/v1', 'https://api.minimaxi.com/v1/voice_design']
  ])('posts voice design requests through %s', async (baseURL, voiceDesignUrl) => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ voice_id: 'CustomVoice001', base_resp: { status_code: 0 } }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    )
    const provider = createMinimaxProvider({ apiKey: 'sk-test', baseURL, fetch })

    const result = await provider.designVoice({ prompt: 'A calm, warm narrator', voiceId: 'CustomVoice001' })

    expect(fetch).toHaveBeenCalledWith(
      voiceDesignUrl,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
    )
    expect(JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      prompt: 'A calm, warm narrator',
      voice_id: 'CustomVoice001'
    })
    expect(result).toEqual({ voiceId: 'CustomVoice001' })
  })

  it('surfaces voice design API errors', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'invalid voice ID' } }), {
        headers: { 'x-request-id': 'request-123' },
        status: 200
      })
    )
    const provider = createMinimaxProvider({ apiKey: 'sk-test', fetch })

    await expect(provider.designVoice({ prompt: 'A calm narrator', voiceId: 'CustomVoice001' })).rejects.toMatchObject({
      message: 'invalid voice ID',
      responseHeaders: { 'x-request-id': 'request-123' }
    })
  })
})
