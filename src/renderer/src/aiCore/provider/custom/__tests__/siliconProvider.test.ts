import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import { describe, expect, it, vi } from 'vitest'

import { createSiliconProvider } from '../silicon-provider'

describe('createSiliconProvider', () => {
  it('uses OpenAI-compatible chat / embedding / image models', () => {
    const provider = createSiliconProvider({
      apiKey: 'sk-test',
      baseURL: 'https://api.siliconflow.cn/v1',
      fetch: vi.fn()
    })

    expect(provider.languageModel('Qwen/Qwen3-8B').provider).toBe('silicon.chat')
    expect(provider.embeddingModel('BAAI/bge-m3').provider).toBe('silicon.embedding')
    expect(provider.imageModel('Qwen/Qwen-Image')).toBeInstanceOf(OpenAICompatibleImageModel)
    expect(provider.imageModel('stable-diffusion-xl')).toBeInstanceOf(OpenAICompatibleImageModel)
  })
})
