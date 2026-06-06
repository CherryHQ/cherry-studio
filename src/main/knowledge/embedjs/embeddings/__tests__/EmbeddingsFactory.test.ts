import type { ApiClient } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ollamaEmbeddingsMock, openAiEmbeddingsMock, voyageEmbeddingsMock } = vi.hoisted(() => ({
  ollamaEmbeddingsMock: vi.fn(),
  openAiEmbeddingsMock: vi.fn(),
  voyageEmbeddingsMock: vi.fn()
}))

vi.mock('@cherrystudio/embedjs-ollama', () => ({
  OllamaEmbeddings: ollamaEmbeddingsMock
}))

vi.mock('@cherrystudio/embedjs-openai', () => ({
  OpenAiEmbeddings: openAiEmbeddingsMock
}))

vi.mock('../VoyageEmbeddings', () => ({
  VoyageEmbeddings: voyageEmbeddingsMock
}))

const createEmbedApiClient = (overrides: Partial<ApiClient>): ApiClient => ({
  apiKey: 'test-key',
  apiVersion: '',
  baseURL: 'https://example.com/v1',
  model: 'text-embedding-3-small',
  provider: 'openai',
  ...overrides
})

describe('EmbeddingsFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes CherryIN model names through without passing dimensions to OpenAI-compatible embeddings', async () => {
    const { default: EmbeddingsFactory } = await import('../EmbeddingsFactory')

    EmbeddingsFactory.create({
      embedApiClient: createEmbedApiClient({
        provider: 'cherryin',
        baseURL: 'https://open.cherryin.ai/v1',
        model: 'baai/bge-m3(free)'
      })
    })

    expect(openAiEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'baai/bge-m3(free)',
        apiKey: 'test-key',
        batchSize: 10,
        configuration: expect.objectContaining({
          baseURL: 'https://open.cherryin.ai/v1'
        })
      })
    )
    expect(openAiEmbeddingsMock.mock.calls[0][0]).not.toHaveProperty('dimensions')
  })

  it('keeps configured dimensions local without passing them to official OpenAI embeddings', async () => {
    const { default: Embeddings } = await import('../Embeddings')

    const embeddings = new Embeddings({
      embedApiClient: createEmbedApiClient({
        provider: 'openai',
        model: 'text-embedding-3-small'
      }),
      dimensions: 768
    })

    expect(openAiEmbeddingsMock.mock.calls[0][0]).not.toHaveProperty('dimensions')
    await expect(embeddings.getDimensions()).resolves.toBe(768)
  })

  it('does not pass dimensions to Ollama or Voyage SDK constructors', async () => {
    const { default: EmbeddingsFactory } = await import('../EmbeddingsFactory')

    EmbeddingsFactory.create({
      embedApiClient: createEmbedApiClient({
        provider: 'ollama',
        baseURL: 'http://localhost:11434/api',
        model: 'nomic-embed-text'
      })
    })
    EmbeddingsFactory.create({
      embedApiClient: createEmbedApiClient({
        provider: 'voyageai',
        model: 'voyage-3'
      })
    })

    expect(ollamaEmbeddingsMock.mock.calls[0][0]).toEqual({
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434'
    })
    expect(voyageEmbeddingsMock.mock.calls[0][0]).toEqual({
      modelName: 'voyage-3',
      apiKey: 'test-key',
      batchSize: 8
    })
  })
})
