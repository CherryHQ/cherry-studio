import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import { describe, expect, it, vi } from 'vitest'

import { createZhipuProvider } from '../zhipuProvider'

describe('createZhipuProvider', () => {
  it('uses OpenAI-compatible chat / embedding / image models', () => {
    const provider = createZhipuProvider({
      apiKey: 'sk-test',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      fetch: vi.fn()
    })

    expect(provider.languageModel('glm-4.5').provider).toBe('zhipu.chat')
    expect(provider.embeddingModel('embedding-3').provider).toBe('zhipu.embedding')
    expect(provider.imageModel('glm-image')).toBeInstanceOf(OpenAICompatibleImageModel)
    expect(provider.imageModel('cogview-4-250304')).toBeInstanceOf(OpenAICompatibleImageModel)
  })

  it('accepts Zhipu image responses that return data[].url', async () => {
    const imageUrl = 'https://maas-watermark-prod-new.cn-wlcb.ufileos.com/generated_watermark.png'
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 1779799425,
          data: [{ url: imageUrl }],
          id: '2026052620434510ac0d93e1e54d65',
          request_id: '2026052620434510ac0d93e1e54d65'
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    const provider = createZhipuProvider({
      apiKey: 'sk-test',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      fetch
    })
    const model = provider.imageModel('glm-image')

    const result = await model.doGenerate({
      prompt: 'a cat',
      n: 1,
      size: '1024x1024',
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {}
    })

    expect(result.images).toEqual([imageUrl])
  })
})
