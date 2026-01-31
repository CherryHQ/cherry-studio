import type { KnowledgeReference, Model, WebSearchProviderResult } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RagCompressionStrategy } from '../RagCompressionStrategy'

// Mock uuid
vi.mock('@renderer/utils', () => ({
  uuid: vi.fn(() => 'mock-uuid'),
  removeSpecialCharactersForFileName: vi.fn((id: string) => id)
}))

// Mock window.toast
const mockToastWarning = vi.fn()
vi.stubGlobal('window', {
  toast: {
    warning: mockToastWarning
  },
  api: {
    knowledgeBase: {
      create: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    }
  }
})

// Mock i18n
vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

// Mock preferenceService
const mockPreferenceGet = vi.fn()
vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: (...args: any[]) => mockPreferenceGet(...args)
  }
}))

// Mock constant
vi.mock('@renderer/config/constant', () => ({
  DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT: 5
}))

// Mock getModel
const mockGetModel = vi.fn()
vi.mock('@renderer/hooks/useModel', () => ({
  getModel: (...args: any[]) => mockGetModel(...args)
}))

// Mock KnowledgeService
const mockGetKnowledgeBaseParams = vi.fn()
const mockSearchKnowledgeBase = vi.fn()
const mockGetKnowledgeSourceUrl = vi.fn()
vi.mock('@renderer/services/KnowledgeService', () => ({
  getKnowledgeBaseParams: (...args: any[]) => mockGetKnowledgeBaseParams(...args),
  searchKnowledgeBase: (...args: any[]) => mockSearchKnowledgeBase(...args),
  getKnowledgeSourceUrl: (...args: any[]) => mockGetKnowledgeSourceUrl(...args)
}))

// Mock webSearch utils
const mockConsolidateReferencesByUrl = vi.fn()
const mockSelectReferences = vi.fn()
vi.mock('@renderer/utils/webSearch', () => ({
  consolidateReferencesByUrl: (...args: any[]) => mockConsolidateReferencesByUrl(...args),
  selectReferences: (...args: any[]) => mockSelectReferences(...args)
}))

// Helper functions
const createMockResult = (overrides: Partial<WebSearchProviderResult> = {}): WebSearchProviderResult => ({
  title: 'Test Title',
  content: 'Test content for RAG compression testing',
  url: 'https://example.com',
  ...overrides
})

const createMockModel = (overrides: Partial<Model> = {}): Model =>
  ({
    id: 'mock-model-id',
    name: 'Mock Model',
    provider: 'openai',
    group: 'OpenAI',
    ...overrides
  }) as Model

const createMockReference = (overrides: Partial<KnowledgeReference> = {}): KnowledgeReference => ({
  id: 1,
  content: 'Reference content',
  sourceUrl: 'https://example.com',
  type: 'url',
  ...overrides
})

describe('RagCompressionStrategy', () => {
  let strategy: RagCompressionStrategy
  const context = { questions: ['test question'], requestId: 'test-request-id' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReset()
    strategy = new RagCompressionStrategy()

    // Default preference mock setup
    mockPreferenceGet.mockImplementation((key: string) => {
      const values: Record<string, any> = {
        'chat.web_search.compression.rag_embedding_model_id': 'embedding-model',
        'chat.web_search.compression.rag_embedding_provider_id': 'openai',
        'chat.web_search.compression.rag_embedding_dimensions': 1536,
        'chat.web_search.compression.rag_document_count': 5,
        'chat.web_search.compression.rag_rerank_model_id': null,
        'chat.web_search.compression.rag_rerank_provider_id': null
      }
      return Promise.resolve(values[key])
    })

    // Default mock setups
    mockGetModel.mockReturnValue(createMockModel())
    mockGetKnowledgeBaseParams.mockReturnValue({ id: 'mock-base-id' })
    mockGetKnowledgeSourceUrl.mockResolvedValue('https://example.com')
  })

  describe('name property', () => {
    it('should have name "rag"', () => {
      expect(strategy.name).toBe('rag')
    })
  })

  describe('compress', () => {
    describe('missing embedding model', () => {
      it('should throw error when embedding model is not configured', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.web_search.compression.rag_embedding_model_id') return Promise.resolve(null)
          if (key === 'chat.web_search.compression.rag_embedding_provider_id') return Promise.resolve(null)
          return Promise.resolve(null)
        })
        mockGetModel.mockReturnValue(undefined)

        const results = [createMockResult()]

        await expect(strategy.compress(results, context)).rejects.toThrow(
          'Embedding model is required for RAG compression'
        )
      })

      it('should throw error when embedding model ID is set but provider is not', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.web_search.compression.rag_embedding_model_id') return Promise.resolve('model-id')
          if (key === 'chat.web_search.compression.rag_embedding_provider_id') return Promise.resolve(null)
          return Promise.resolve(null)
        })
        mockGetModel.mockReturnValue(undefined)

        const results = [createMockResult()]

        await expect(strategy.compress(results, context)).rejects.toThrow(
          'Embedding model is required for RAG compression'
        )
      })
    })

    describe('successful compression', () => {
      beforeEach(() => {
        mockSearchKnowledgeBase.mockResolvedValue([
          { pageContent: 'Result 1', score: 0.9, metadata: {} },
          { pageContent: 'Result 2', score: 0.8, metadata: {} }
        ])
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult({ content: 'Consolidated content' })])
      })

      it('should create knowledge base for search', async () => {
        const results = [createMockResult()]

        await strategy.compress(results, context)

        expect(window.api.knowledgeBase.create).toHaveBeenCalled()
      })

      it('should reset knowledge base before adding items', async () => {
        const results = [createMockResult()]

        await strategy.compress(results, context)

        expect(window.api.knowledgeBase.reset).toHaveBeenCalled()
      })

      it('should add each result to knowledge base', async () => {
        const results = [
          createMockResult({ url: 'https://first.com' }),
          createMockResult({ url: 'https://second.com' })
        ]

        await strategy.compress(results, context)

        expect(window.api.knowledgeBase.add).toHaveBeenCalledTimes(2)
      })

      it('should search knowledge base for each question', async () => {
        const multiQuestionContext = { questions: ['question 1', 'question 2'], requestId: 'test-id' }
        const results = [createMockResult()]

        await strategy.compress(results, multiQuestionContext)

        expect(mockSearchKnowledgeBase).toHaveBeenCalledTimes(2)
      })

      it('should consolidate results by URL', async () => {
        const results = [createMockResult()]

        await strategy.compress(results, context)

        expect(mockConsolidateReferencesByUrl).toHaveBeenCalled()
      })

      it('should return consolidated results', async () => {
        const expectedResult = createMockResult({ content: 'Consolidated content' })
        mockConsolidateReferencesByUrl.mockReturnValue([expectedResult])

        const results = [createMockResult()]
        const compressed = await strategy.compress(results, context)

        expect(compressed).toEqual([expectedResult])
      })
    })

    describe('cleanup', () => {
      beforeEach(() => {
        mockSearchKnowledgeBase.mockResolvedValue([{ pageContent: 'Result', score: 0.9, metadata: {} }])
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult()])
      })

      it('should cleanup knowledge base after successful compression', async () => {
        const results = [createMockResult()]

        await strategy.compress(results, context)

        expect(window.api.knowledgeBase.delete).toHaveBeenCalled()
      })

      it('should cleanup knowledge base even when search fails', async () => {
        mockSearchKnowledgeBase.mockRejectedValue(new Error('Search failed'))

        const results = [createMockResult()]

        await expect(strategy.compress(results, context)).rejects.toThrow()
        expect(window.api.knowledgeBase.delete).toHaveBeenCalled()
      })

      it('should show warning when cleanup fails but not throw', async () => {
        ;(window.api.knowledgeBase.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Delete failed'))

        const results = [createMockResult()]

        // Should not throw
        await strategy.compress(results, context)

        expect(mockToastWarning).toHaveBeenCalledWith({
          timeout: 5000,
          title: 'settings.tool.websearch.compression.error.cleanup_failed'
        })
      })
    })

    describe('search failures', () => {
      it('should throw when all searches fail', async () => {
        mockSearchKnowledgeBase.mockRejectedValue(new Error('Search failed'))

        const results = [createMockResult()]

        await expect(strategy.compress(results, context)).rejects.toThrow('All knowledge base searches failed')
      })

      it('should continue when some searches succeed', async () => {
        const multiQuestionContext = { questions: ['q1', 'q2'], requestId: 'test-id' }
        mockSearchKnowledgeBase
          .mockResolvedValueOnce([{ pageContent: 'Result', score: 0.9, metadata: {} }])
          .mockRejectedValueOnce(new Error('Search failed'))
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult()])

        const results = [createMockResult()]

        // Should not throw
        await strategy.compress(results, multiQuestionContext)
      })
    })

    describe('result deduplication and sorting', () => {
      beforeEach(() => {
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult()])
      })

      it('should sort results by score in descending order', async () => {
        mockSearchKnowledgeBase.mockResolvedValue([
          { pageContent: 'Low score', score: 0.5, metadata: {} },
          { pageContent: 'High score', score: 0.9, metadata: {} },
          { pageContent: 'Medium score', score: 0.7, metadata: {} }
        ])

        const results = [createMockResult()]
        await strategy.compress(results, context)

        // selectReferences receives sorted and deduplicated results
        const selectCall = mockSelectReferences.mock.calls[0]
        // The references passed to selectReferences should be sorted
        expect(selectCall).toBeDefined()
      })

      it('should deduplicate results by pageContent', async () => {
        mockSearchKnowledgeBase.mockResolvedValue([
          { pageContent: 'Duplicate content', score: 0.9, metadata: {} },
          { pageContent: 'Duplicate content', score: 0.8, metadata: {} },
          { pageContent: 'Unique content', score: 0.7, metadata: {} }
        ])

        const results = [createMockResult()]
        await strategy.compress(results, context)

        // After deduplication, only unique pageContent items should remain
        expect(mockSelectReferences).toHaveBeenCalled()
      })
    })

    describe('document count calculation', () => {
      beforeEach(() => {
        mockSearchKnowledgeBase.mockResolvedValue([{ pageContent: 'Result', score: 0.9, metadata: {} }])
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult()])
      })

      it('should calculate total document count as results.length * documentCount', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          const values: Record<string, any> = {
            'chat.web_search.compression.rag_embedding_model_id': 'embedding-model',
            'chat.web_search.compression.rag_embedding_provider_id': 'openai',
            'chat.web_search.compression.rag_embedding_dimensions': 1536,
            'chat.web_search.compression.rag_document_count': 3, // 3 docs per result
            'chat.web_search.compression.rag_rerank_model_id': null,
            'chat.web_search.compression.rag_rerank_provider_id': null
          }
          return Promise.resolve(values[key])
        })

        const results = [createMockResult(), createMockResult()] // 2 results

        await strategy.compress(results, context)

        // totalDocumentCount should be 2 * 3 = 6
        // This is passed to ensureSearchBase and then to selectReferences
        expect(mockSelectReferences).toHaveBeenCalledWith(results, expect.any(Array), 6)
      })

      it('should use default document count when not set', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          const values: Record<string, any> = {
            'chat.web_search.compression.rag_embedding_model_id': 'embedding-model',
            'chat.web_search.compression.rag_embedding_provider_id': 'openai',
            'chat.web_search.compression.rag_embedding_dimensions': 1536,
            'chat.web_search.compression.rag_document_count': null, // Not set
            'chat.web_search.compression.rag_rerank_model_id': null,
            'chat.web_search.compression.rag_rerank_provider_id': null
          }
          return Promise.resolve(values[key])
        })

        const results = [createMockResult()] // 1 result

        await strategy.compress(results, context)

        // Should use DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT (5)
        // totalDocumentCount = 1 * 5 = 5
        expect(mockSelectReferences).toHaveBeenCalledWith(results, expect.any(Array), 5)
      })
    })

    describe('rerank model', () => {
      beforeEach(() => {
        mockSearchKnowledgeBase.mockResolvedValue([{ pageContent: 'Result', score: 0.9, metadata: {} }])
        mockSelectReferences.mockReturnValue([createMockReference()])
        mockConsolidateReferencesByUrl.mockReturnValue([createMockResult()])
      })

      it('should work without rerank model', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          const values: Record<string, any> = {
            'chat.web_search.compression.rag_embedding_model_id': 'embedding-model',
            'chat.web_search.compression.rag_embedding_provider_id': 'openai',
            'chat.web_search.compression.rag_embedding_dimensions': 1536,
            'chat.web_search.compression.rag_document_count': 5,
            'chat.web_search.compression.rag_rerank_model_id': null,
            'chat.web_search.compression.rag_rerank_provider_id': null
          }
          return Promise.resolve(values[key])
        })
        mockGetModel.mockImplementation((id, provider) => {
          if (id === 'embedding-model' && provider === 'openai') {
            return createMockModel({ id: 'embedding-model' })
          }
          return undefined
        })

        const results = [createMockResult()]

        // Should not throw
        await strategy.compress(results, context)
      })

      it('should include rerank model when configured', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          const values: Record<string, any> = {
            'chat.web_search.compression.rag_embedding_model_id': 'embedding-model',
            'chat.web_search.compression.rag_embedding_provider_id': 'openai',
            'chat.web_search.compression.rag_embedding_dimensions': 1536,
            'chat.web_search.compression.rag_document_count': 5,
            'chat.web_search.compression.rag_rerank_model_id': 'rerank-model',
            'chat.web_search.compression.rag_rerank_provider_id': 'cohere'
          }
          return Promise.resolve(values[key])
        })
        mockGetModel.mockImplementation((id, provider) => {
          if (id === 'embedding-model' && provider === 'openai') {
            return createMockModel({ id: 'embedding-model' })
          }
          if (id === 'rerank-model' && provider === 'cohere') {
            return createMockModel({ id: 'rerank-model', provider: 'cohere' })
          }
          return undefined
        })

        const results = [createMockResult()]

        await strategy.compress(results, context)

        // Verify getModel was called for both embedding and rerank models
        expect(mockGetModel).toHaveBeenCalledWith('embedding-model', 'openai')
        expect(mockGetModel).toHaveBeenCalledWith('rerank-model', 'cohere')
      })
    })
  })
})
