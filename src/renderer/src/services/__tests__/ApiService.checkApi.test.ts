import type { Assistant, Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const aiProviderMocks = vi.hoisted(() => ({
  completions: vi.fn(),
  generateImage: vi.fn(),
  getEmbeddingDimensions: vi.fn()
}))
const probeOllamaModel = vi.hoisted(() => vi.fn())

vi.mock('@renderer/aiCore/services', () => ({ probeOllamaModel }))

vi.mock('../../aiCore', () => ({
  AiProvider: class {
    completions = aiProviderMocks.completions
    generateImage = aiProviderMocks.generateImage
    getEmbeddingDimensions = aiProviderMocks.getEmbeddingDimensions
  }
}))

vi.mock('../AssistantService', () => ({
  getDefaultAssistant: () => ({ id: 'assistant', name: 'Assistant' }) as Assistant,
  getDefaultModel: vi.fn(),
  getProviderByModel: vi.fn(),
  getQuickModel: vi.fn()
}))

const { checkApi } = await import('../ApiService')

describe('checkApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiProviderMocks.generateImage.mockResolvedValue(['data:image/png;base64,aGVsbG8='])
    probeOllamaModel.mockResolvedValue(undefined)
  })

  it('checks image-only models through image generation instead of chat', async () => {
    const model = {
      id: 'qwen-image-3.0',
      name: 'Qwen Image 3.0',
      provider: 'dashscope',
      group: 'qwen'
    } as Model
    const provider = {
      id: 'dashscope',
      name: 'DashScope',
      type: 'openai',
      apiKey: 'test',
      apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: [model]
    } as Provider

    await checkApi(provider, model)

    expect(aiProviderMocks.generateImage).toHaveBeenCalledWith({
      model: model.id,
      prompt: 'hi',
      imageSize: '1024x1024',
      batchSize: 1
    })
    expect(aiProviderMocks.completions).not.toHaveBeenCalled()
  })

  it('checks Ollama model availability without loading the model', async () => {
    const model = { id: 'qwen3:8b', name: 'Qwen 3', provider: 'ollama', group: 'ollama' } as Model
    const provider = {
      id: 'ollama',
      name: 'Ollama',
      type: 'ollama',
      apiKey: '',
      apiHost: 'http://localhost:11434',
      models: [model],
      isSystem: true
    } as Provider

    await checkApi(provider, model)

    expect(probeOllamaModel).toHaveBeenCalledWith(provider, model.id, expect.any(AbortSignal))
    expect(aiProviderMocks.completions).not.toHaveBeenCalled()
  })
})
