import { ErrorCode } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Provider } from '@types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: mockSelect
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'base-1',
    name: 'Knowledge Base',
    embeddingModelId: 'openai:text-embedding-3-small',
    embeddingModelMeta: {
      id: 'text-embedding-3-small',
      name: 'text-embedding-3-small',
      provider: 'openai',
      dimensions: 1536
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    apiKey: 'test-key',
    apiHost: 'https://api.openai.com/v1',
    models: [],
    ...overrides
  } as Provider
}

async function loadAdapter() {
  const module = await import('../KnowledgeProviderAdapter')
  return module.knowledgeProviderAdapter
}

async function expectValidationFieldError(promise: Promise<unknown>, field: string, expectedMessage: string) {
  const error = await promise.catch((value) => value)

  expect(error).toMatchObject({
    code: ErrorCode.VALIDATION_ERROR,
    message: 'Request validation failed'
  })

  const fieldErrors = (error as { details?: { fieldErrors?: Record<string, string[]> } }).details?.fieldErrors ?? {}
  expect(fieldErrors[field]).toContain(expectedMessage)
}

describe('KnowledgeProviderAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSelect.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws validation error when embedding model id is empty', async () => {
    const adapter = await loadAdapter()

    await expectValidationFieldError(
      adapter.buildBaseParams(createBase({ embeddingModelId: '   ' }), 'embeddingModelId'),
      'embeddingModelId',
      'Model id is required'
    )
  })

  it('throws validation error when provider id cannot be resolved', async () => {
    const adapter = await loadAdapter()

    await expectValidationFieldError(
      adapter.buildBaseParams(
        createBase({
          embeddingModelId: 'text-embedding-3-small',
          embeddingModelMeta: null
        }),
        'embeddingModelId'
      ),
      'embeddingModelId',
      'Provider is required'
    )
  })

  it('throws validation error when provider is not configured', async () => {
    const adapter = await loadAdapter()

    await expectValidationFieldError(
      adapter.buildBaseParams(createBase(), 'embeddingModelId'),
      'embeddingModelId',
      "Provider 'openai' is not configured"
    )
  })

  it('normalizes endpoint url with trailing # marker', async () => {
    const adapter = await loadAdapter()
    mockSelect.mockResolvedValue([
      createProvider({
        apiHost: 'https://example.com/v1/chat/completions#'
      })
    ])

    const resolved = await adapter.buildBaseParams(createBase(), 'embeddingModelId')

    expect(resolved.embedApiClient.baseURL).toBe('https://example.com/v1')
    expect(resolved.embedApiClient.model).toBe('text-embedding-3-small')
    expect(mockSelect).toHaveBeenCalledWith('state.llm.providers')
  })

  it('applies provider specific base url transforms', async () => {
    const adapter = await loadAdapter()

    mockSelect.mockResolvedValue([
      createProvider({
        id: 'gemini',
        type: 'gemini',
        apiHost: 'https://gemini.example.com/'
      })
    ])

    const geminiResolved = await adapter.buildBaseParams(
      createBase({
        embeddingModelId: 'gemini:text-embedding-004',
        embeddingModelMeta: { id: 'text-embedding-004', name: 'text-embedding-004', provider: 'gemini' }
      }),
      'embeddingModelId'
    )
    expect(geminiResolved.embedApiClient.baseURL).toBe('https://gemini.example.com/openai')

    mockSelect.mockResolvedValue([
      createProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://azure.example.com'
      })
    ])

    const azureResolved = await adapter.buildBaseParams(
      createBase({
        embeddingModelId: 'azure-openai:text-embedding',
        embeddingModelMeta: { id: 'text-embedding', name: 'text-embedding', provider: 'azure-openai' }
      }),
      'embeddingModelId'
    )
    expect(azureResolved.embedApiClient.baseURL).toBe('https://azure.example.com/v1')

    mockSelect.mockResolvedValue([
      createProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434/api'
      })
    ])

    const ollamaResolved = await adapter.buildBaseParams(
      createBase({
        embeddingModelId: 'ollama:nomic-embed-text',
        embeddingModelMeta: { id: 'nomic-embed-text', name: 'nomic-embed-text', provider: 'ollama' }
      }),
      'embeddingModelId'
    )
    expect(ollamaResolved.embedApiClient.baseURL).toBe('http://localhost:11434')
  })

  it('requires rerank model when resolving rerank params', async () => {
    const adapter = await loadAdapter()
    mockSelect.mockResolvedValue([createProvider()])

    await expectValidationFieldError(
      adapter.buildBaseParams(
        createBase({
          rerankModelId: undefined,
          rerankModelMeta: null
        }),
        'rerankModelId'
      ),
      'rerankModelId',
      'Rerank model is not configured'
    )
  })
})
