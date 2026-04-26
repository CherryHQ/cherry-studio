import type { Assistant, Model } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockEditImage = vi.fn()

vi.mock('@renderer/aiCore', () => ({
  AiProvider: vi.fn().mockImplementation(() => ({
    generateImage: mockGenerateImage,
    editImage: mockEditImage
  }))
}))

vi.mock('@renderer/services/AssistantService', () => {
  const defaultModel = { id: 'gpt-image-1', provider: 'openai' }
  const defaultAssistant = {
    id: 'default',
    name: 'Default',
    prompt: '',
    topics: [],
    type: 'assistant',
    settings: { customParameters: [] }
  }
  return {
    DEFAULT_ASSISTANT_SETTINGS: { customParameters: [], contextCount: 10 },
    getDefaultAssistant: vi.fn().mockReturnValue(defaultAssistant),
    getDefaultModel: vi.fn().mockReturnValue(defaultModel),
    getDefaultTopic: vi.fn().mockReturnValue({ id: 'topic-1', messages: [] }),
    getProviderByModel: vi.fn().mockReturnValue({ id: 'openai', apiKey: 'key' }),
    getProviderByModelId: vi.fn().mockReturnValue({ id: 'openai', apiKey: 'key' }),
    getQuickModel: vi.fn().mockReturnValue(defaultModel),
    getAssistantSettings: vi.fn().mockReturnValue({ customParameters: [] }),
    getAssistantById: vi.fn(),
    getDefaultAssistantSettings: vi.fn().mockReturnValue({ customParameters: [] }),
    getDefaultProvider: vi.fn().mockReturnValue({ id: 'openai' }),
    getAssistantProvider: vi.fn().mockReturnValue({ id: 'openai', apiKey: 'key' })
  }
})

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: vi.fn().mockReturnValue('draw a cat'),
  findImageBlocks: vi.fn().mockReturnValue([]),
  findFileBlocks: vi.fn().mockReturnValue([])
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: { readBase64File: vi.fn().mockResolvedValue('') }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/store', () => ({ default: { getState: vi.fn().mockReturnValue({ settings: {} }) } }))
vi.mock('@renderer/store/mcp', () => ({ hubMCPServer: {} }))
vi.mock('@renderer/hooks/useSettings', () => ({ getStoreSetting: vi.fn() }))
vi.mock('@renderer/utils/abortController', () => ({ readyToAbort: vi.fn() }))
vi.mock('@renderer/utils/analytics', () => ({ trackTokenUsage: vi.fn() }))

const makeAssistant = (customParameters: { name: string; value: string; type: 'string' }[] = []): Assistant =>
  ({
    id: 'a1',
    name: 'Test',
    prompt: '',
    topics: [],
    type: 'assistant',
    model: { id: 'gpt-image-1', provider: 'openai' } as Model,
    settings: { customParameters }
  }) as unknown as Assistant

const makeUserMessage = () =>
  ({ id: 'm1', role: 'user', topicId: 't1', assistantId: 'a1', blocks: [], createdAt: '', status: 'success' }) as any

describe('fetchImageGeneration — imageSize and batchSize from customParameters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateImage.mockResolvedValue(['data:image/png;base64,abc'])
  })

  it('defaults to 1024x1024 and batchSize 1 when no customParameters', async () => {
    const { fetchImageGeneration } = await import('../ApiService')
    const chunks: any[] = []

    await fetchImageGeneration({
      messages: [makeUserMessage()],
      assistant: makeAssistant(),
      onChunkReceived: (c) => chunks.push(c)
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ imageSize: '1024x1024', batchSize: 1 }))
  })

  it('reads imageSize from "size" custom parameter', async () => {
    const { fetchImageGeneration } = await import('../ApiService')

    await fetchImageGeneration({
      messages: [makeUserMessage()],
      assistant: makeAssistant([{ name: 'size', value: '1792x1024', type: 'string' }]),
      onChunkReceived: vi.fn()
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ imageSize: '1792x1024' }))
  })

  it('reads imageSize from "imageSize" custom parameter', async () => {
    const { fetchImageGeneration } = await import('../ApiService')

    await fetchImageGeneration({
      messages: [makeUserMessage()],
      assistant: makeAssistant([{ name: 'imageSize', value: '1024x1792', type: 'string' }]),
      onChunkReceived: vi.fn()
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ imageSize: '1024x1792' }))
  })

  it('reads batchSize from "n" custom parameter', async () => {
    const { fetchImageGeneration } = await import('../ApiService')

    await fetchImageGeneration({
      messages: [makeUserMessage()],
      assistant: makeAssistant([{ name: 'n', value: '3', type: 'string' }]),
      onChunkReceived: vi.fn()
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 3 }))
  })

  it('emits IMAGE_COMPLETE chunk with generated images', async () => {
    const { fetchImageGeneration } = await import('../ApiService')
    const chunks: any[] = []

    await fetchImageGeneration({
      messages: [makeUserMessage()],
      assistant: makeAssistant(),
      onChunkReceived: (c) => chunks.push(c)
    })

    const completeChunk = chunks.find((c) => c.type === ChunkType.IMAGE_COMPLETE)
    expect(completeChunk).toBeDefined()
    expect(completeChunk.image.images).toContain('data:image/png;base64,abc')
  })
})
