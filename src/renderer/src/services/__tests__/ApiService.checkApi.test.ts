import type * as ModelsModule from '@renderer/config/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateImageMock = vi.hoisted(() => vi.fn())
const completionsMock = vi.hoisted(() => vi.fn())
const getEmbeddingDimensionsMock = vi.hoisted(() => vi.fn())
const isDedicatedImageGenerationModelMock = vi.hoisted(() => vi.fn())
const isEmbeddingModelMock = vi.hoisted(() => vi.fn())
const getDefaultAssistantMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/models', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelsModule>()

  return {
    ...actual,
    isDedicatedImageGenerationModel: (...args: any[]) => isDedicatedImageGenerationModelMock(...args),
    isEmbeddingModel: (...args: any[]) => isEmbeddingModelMock(...args),
    isFunctionCallingModel: vi.fn(() => false)
  }
})

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({ mcp: { servers: [] } }))
  }
}))

vi.mock('@renderer/store/mcp', () => ({
  hubMCPServer: { id: 'hub', name: 'hub', isActive: true }
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn()
}))

vi.mock('../../aiCore', () => ({
  AiProvider: vi.fn().mockImplementation(() => ({
    generateImage: generateImageMock,
    completions: completionsMock,
    getEmbeddingDimensions: getEmbeddingDimensionsMock
  }))
}))

vi.mock('../AssistantService', () => ({
  getDefaultAssistant: (...args: any[]) => getDefaultAssistantMock(...args),
  getDefaultModel: vi.fn(() => ({ id: 'default-model' })),
  getProviderByModel: vi.fn(),
  getQuickModel: vi.fn()
}))

vi.mock('../ConversationService', () => ({
  ConversationService: {
    prepareMessagesForModel: vi.fn()
  }
}))

vi.mock('../KnowledgeService', () => ({
  injectUserMessageWithKnowledgeSearchPrompt: vi.fn()
}))

import { checkApi } from '../ApiService'

describe('checkApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateImageMock.mockResolvedValue(['data:image/png;base64,ZmFrZQ=='])
    completionsMock.mockResolvedValue(undefined)
    getEmbeddingDimensionsMock.mockResolvedValue(1536)
    isEmbeddingModelMock.mockReturnValue(false)
    isDedicatedImageGenerationModelMock.mockReturnValue(true)
    getDefaultAssistantMock.mockReturnValue({
      id: 'default',
      name: 'Default Assistant',
      prompt: '',
      settings: {}
    })
    ;(globalThis as any).window = {
      toast: {
        error: vi.fn()
      }
    }
  })

  it('validates dedicated image models with generateImage instead of chat completions', async () => {
    const provider = {
      id: 'custom-openai',
      type: 'openai',
      apiKey: 'sk-test',
      apiHost: 'https://api.example.com',
      models: [{ id: 'gpt-image-2' }]
    } as any

    const model = {
      id: 'gpt-image-2'
    } as any

    await checkApi(provider, model, 1000)

    expect(generateImageMock).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      prompt: 'test',
      imageSize: '1024x1024',
      batchSize: 1
    })
    expect(completionsMock).not.toHaveBeenCalled()
  })
})
