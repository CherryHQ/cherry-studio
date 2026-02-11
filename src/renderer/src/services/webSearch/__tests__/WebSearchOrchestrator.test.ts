import type { WebSearchProvider, WebSearchProviderResult } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompressionStrategyFactory } from '../compression'
import type { ICompressionStrategy, IRequestStateManager, ISearchStatusTracker, RequestState } from '../interfaces'
import { WebSearchOrchestrator } from '../WebSearchOrchestrator'

// Mock preferenceService
const mockPreferenceGet = vi.fn()
vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: (...args: any[]) => mockPreferenceGet(...args)
  }
}))

// Mock window.toast
const mockToastWarning = vi.fn()
vi.stubGlobal('window', {
  toast: {
    warning: mockToastWarning
  }
})

// Mock i18n
vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

// Mock error utils
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: vi.fn((err) => (err instanceof Error ? err.message : String(err)))
}))

// Mock fetchWebContents
const mockFetchWebContents = vi.fn()
vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContents: (...args: any[]) => mockFetchWebContents(...args)
}))

// Mock WebSearchEngineProvider
const mockSearch = vi.fn()
vi.mock('../providers/WebSearchEngineProvider', () => ({
  default: vi.fn().mockImplementation(() => ({
    search: mockSearch
  }))
}))

// Mock dayjs
vi.mock('dayjs', () => ({
  default: () => ({
    format: () => '2026-01-21'
  })
}))

// Helper functions
const createMockResult = (overrides: Partial<WebSearchProviderResult> = {}): WebSearchProviderResult => ({
  title: 'Test Title',
  content: 'Test content',
  url: 'https://example.com',
  ...overrides
})

const createMockProvider = (overrides: Partial<WebSearchProvider> = {}): WebSearchProvider =>
  ({
    id: 'test-provider',
    type: 'tavily',
    apiKey: 'test-key',
    apiHost: 'https://api.test.com',
    ...overrides
  }) as WebSearchProvider

const createMockExtractResults = (overrides: Partial<ExtractResults['websearch']> = {}): ExtractResults => ({
  websearch: {
    question: ['test question'],
    links: [],
    ...overrides
  }
})

// Mock implementations
const createMockRequestStateManager = (): IRequestStateManager => ({
  getRequestState: vi.fn().mockReturnValue({ signal: null, isPaused: false, createdAt: Date.now() } as RequestState),
  createAbortSignal: vi.fn(),
  clearRequestState: vi.fn(),
  getSignal: vi.fn().mockReturnValue(null),
  isPaused: false
})

const createMockStatusTracker = (): ISearchStatusTracker => ({
  setStatus: vi.fn().mockResolvedValue(undefined),
  clearStatus: vi.fn()
})

const createMockCompressionStrategy = (name: string = 'none'): ICompressionStrategy => ({
  name: name as any,
  compress: vi.fn().mockImplementation((results) => Promise.resolve(results))
})

const createMockCompressionFactory = (strategy?: ICompressionStrategy): CompressionStrategyFactory =>
  ({
    getStrategy: vi.fn().mockResolvedValue(strategy ?? createMockCompressionStrategy()),
    registerStrategy: vi.fn()
  }) as any

describe('WebSearchOrchestrator', () => {
  let orchestrator: WebSearchOrchestrator
  let mockRequestStateManager: IRequestStateManager
  let mockStatusTracker: ISearchStatusTracker
  let mockCompressionFactory: CompressionStrategyFactory

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReset()

    mockRequestStateManager = createMockRequestStateManager()
    mockStatusTracker = createMockStatusTracker()
    mockCompressionFactory = createMockCompressionFactory()

    orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

    // Default preference values
    mockPreferenceGet.mockImplementation((key: string) => {
      if (key === 'chat.web_search.search_with_time') return Promise.resolve(false)
      if (key === 'chat.web_search.compression.method') return Promise.resolve('none')
      return Promise.resolve(null)
    })
  })

  describe('processWebsearch', () => {
    describe('empty/invalid questions', () => {
      it('should return empty results when websearch is undefined', async () => {
        const extractResults = { websearch: undefined } as ExtractResults

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result).toEqual({ results: [] })
      })

      it('should return empty results when question array is empty', async () => {
        const extractResults = createMockExtractResults({ question: [] })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result).toEqual({ results: [] })
      })

      it('should return empty results when question is null', async () => {
        const extractResults = createMockExtractResults({ question: null as any })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result).toEqual({ results: [] })
      })
    })

    describe('summarize flow', () => {
      it('should fetch web contents when question is "summarize" and links exist', async () => {
        const mockContents = [createMockResult({ content: 'Fetched content' })]
        mockFetchWebContents.mockResolvedValue(mockContents)

        const extractResults = createMockExtractResults({
          question: ['summarize'],
          links: ['https://example1.com', 'https://example2.com']
        })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockFetchWebContents).toHaveBeenCalledWith(
          ['https://example1.com', 'https://example2.com'],
          undefined,
          undefined,
          { signal: null }
        )
        expect(result).toEqual({ query: 'summaries', results: mockContents })
      })

      it('should throw error when fetch web contents fails', async () => {
        mockFetchWebContents.mockRejectedValue(new Error('Network error'))

        const extractResults = createMockExtractResults({
          question: ['summarize'],
          links: ['https://example.com']
        })

        await expect(orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')).rejects.toThrow(
          'Failed to fetch web contents: Network error'
        )
      })

      it('should not use summarize flow when links are empty', async () => {
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({
          question: ['summarize'],
          links: []
        })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockSearch).toHaveBeenCalled()
        expect(mockFetchWebContents).not.toHaveBeenCalled()
      })
    })

    describe('normal search flow', () => {
      it('should search for each question', async () => {
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({
          question: ['question 1', 'question 2']
        })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockSearch).toHaveBeenCalledTimes(2)
      })

      it('should add date prefix when search_with_time is enabled', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.web_search.search_with_time') return Promise.resolve(true)
          if (key === 'chat.web_search.compression.method') return Promise.resolve('none')
          return Promise.resolve(null)
        })
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({ question: ['test query'] })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockSearch).toHaveBeenCalledWith('today is 2026-01-21 \r\n test query', expect.any(Object))
      })

      it('should combine results from multiple questions', async () => {
        mockSearch
          .mockResolvedValueOnce({ results: [createMockResult({ url: 'https://first.com' })] })
          .mockResolvedValueOnce({ results: [createMockResult({ url: 'https://second.com' })] })

        const extractResults = createMockExtractResults({
          question: ['q1', 'q2']
        })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result.results).toHaveLength(2)
      })

      it('should return empty results when search returns no results', async () => {
        mockSearch.mockResolvedValue({ results: [] })

        const extractResults = createMockExtractResults({ question: ['test'] })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result).toEqual({ query: 'test', results: [] })
      })

      it('should throw when any search fails', async () => {
        mockSearch
          .mockResolvedValueOnce({ results: [createMockResult()] })
          .mockRejectedValueOnce(new Error('Search failed'))

        const extractResults = createMockExtractResults({
          question: ['q1', 'q2']
        })

        await expect(orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')).rejects.toThrow(
          'Search failed'
        )
      })
    })

    describe('compression', () => {
      describe('RAG compression', () => {
        it('should apply RAG compression when method is "rag"', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('rag')
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const ragStrategy = createMockCompressionStrategy('rag')
          const compressedResult = createMockResult({ content: 'RAG compressed' })
          ;(ragStrategy.compress as ReturnType<typeof vi.fn>).mockResolvedValue([compressedResult])

          mockCompressionFactory = createMockCompressionFactory(ragStrategy)
          orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

          const extractResults = createMockExtractResults({ question: ['test'] })

          const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          expect(ragStrategy.compress).toHaveBeenCalled()
          expect(result.results).toEqual([compressedResult])
        })

        it('should set RAG status phases', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('rag')
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const ragStrategy = createMockCompressionStrategy('rag')
          ;(ragStrategy.compress as ReturnType<typeof vi.fn>).mockResolvedValue([createMockResult()])

          mockCompressionFactory = createMockCompressionFactory(ragStrategy)
          orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

          const extractResults = createMockExtractResults({ question: ['test'] })

          await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          // Should set rag phase, then rag_complete
          expect(mockStatusTracker.setStatus).toHaveBeenCalledWith('request-1', { phase: 'rag' }, 500)
          expect(mockStatusTracker.setStatus).toHaveBeenCalledWith(
            'request-1',
            { phase: 'rag_complete', countBefore: 1, countAfter: 1 },
            1000
          )
        })

        it('should keep original results when RAG compression fails', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('rag')
            return Promise.resolve(false)
          })
          const originalResult = createMockResult({ content: 'Original content' })
          mockSearch.mockResolvedValue({ results: [originalResult] })

          const ragStrategy = createMockCompressionStrategy('rag')
          ;(ragStrategy.compress as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RAG failed'))

          mockCompressionFactory = createMockCompressionFactory(ragStrategy)
          orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

          const extractResults = createMockExtractResults({ question: ['test'] })

          const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          // Should return original results
          expect(result.results).toEqual([originalResult])
          expect(mockToastWarning).toHaveBeenCalled()
          expect(mockStatusTracker.setStatus).toHaveBeenCalledWith('request-1', { phase: 'rag_failed' }, 1000)
        })
      })

      describe('Cutoff compression', () => {
        it('should apply cutoff compression when method is "cutoff"', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('cutoff')
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const cutoffStrategy = createMockCompressionStrategy('cutoff')
          const compressedResult = createMockResult({ content: 'Cutoff compressed' })
          ;(cutoffStrategy.compress as ReturnType<typeof vi.fn>).mockResolvedValue([compressedResult])

          mockCompressionFactory = createMockCompressionFactory(cutoffStrategy)
          orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

          const extractResults = createMockExtractResults({ question: ['test'] })

          const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          expect(cutoffStrategy.compress).toHaveBeenCalled()
          expect(result.results).toEqual([compressedResult])
        })

        it('should set cutoff status phase', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('cutoff')
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const cutoffStrategy = createMockCompressionStrategy('cutoff')
          ;(cutoffStrategy.compress as ReturnType<typeof vi.fn>).mockResolvedValue([createMockResult()])

          mockCompressionFactory = createMockCompressionFactory(cutoffStrategy)
          orchestrator = new WebSearchOrchestrator(mockRequestStateManager, mockStatusTracker, mockCompressionFactory)

          const extractResults = createMockExtractResults({ question: ['test'] })

          await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          expect(mockStatusTracker.setStatus).toHaveBeenCalledWith('request-1', { phase: 'cutoff' }, 500)
        })
      })

      describe('No compression', () => {
        it('should skip compression when method is "none"', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve('none')
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const extractResults = createMockExtractResults({ question: ['test'] })

          await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          expect(mockCompressionFactory.getStrategy).not.toHaveBeenCalled()
        })

        it('should skip compression when method is null', async () => {
          mockPreferenceGet.mockImplementation((key: string) => {
            if (key === 'chat.web_search.compression.method') return Promise.resolve(null)
            return Promise.resolve(false)
          })
          mockSearch.mockResolvedValue({ results: [createMockResult()] })

          const extractResults = createMockExtractResults({ question: ['test'] })

          await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

          expect(mockCompressionFactory.getStrategy).not.toHaveBeenCalled()
        })
      })
    })

    describe('status tracking', () => {
      it('should set initial status to default', async () => {
        mockSearch.mockResolvedValue({ results: [createMockResult()] })
        const extractResults = createMockExtractResults({ question: ['test'] })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockStatusTracker.setStatus).toHaveBeenCalledWith('request-1', { phase: 'default' })
      })

      it('should set fetch_complete status when multiple searches succeed', async () => {
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({
          question: ['q1', 'q2']
        })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockStatusTracker.setStatus).toHaveBeenCalledWith(
          'request-1',
          { phase: 'fetch_complete', countAfter: 2 },
          1000
        )
      })

      it('should reset status to default in finally block', async () => {
        mockSearch.mockRejectedValue(new Error('Search error'))
        const extractResults = createMockExtractResults({ question: ['test'] })

        try {
          await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')
        } catch {
          // Expected
        }

        // Last call should be resetting to default
        const lastCall = (mockStatusTracker.setStatus as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0]
        expect(lastCall).toEqual(['request-1', { phase: 'default' }])
      })
    })

    describe('abort signal', () => {
      it('should pass abort signal from request state to search', async () => {
        const mockSignal = new AbortController().signal
        ;(mockRequestStateManager.getRequestState as ReturnType<typeof vi.fn>).mockReturnValue({
          signal: mockSignal,
          isPaused: false,
          createdAt: Date.now()
        })
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({ question: ['test'] })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockSearch).toHaveBeenCalledWith(expect.any(String), { signal: mockSignal })
      })

      it('should use global signal when request state signal is null', async () => {
        const mockGlobalSignal = new AbortController().signal
        ;(mockRequestStateManager.getRequestState as ReturnType<typeof vi.fn>).mockReturnValue({
          signal: null,
          isPaused: false,
          createdAt: Date.now()
        })
        ;(mockRequestStateManager.getSignal as ReturnType<typeof vi.fn>).mockReturnValue(mockGlobalSignal)
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({ question: ['test'] })

        await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(mockSearch).toHaveBeenCalledWith(expect.any(String), { signal: mockGlobalSignal })
      })
    })

    describe('query string in response', () => {
      it('should join multiple questions with " | " in query', async () => {
        mockSearch.mockResolvedValue({ results: [createMockResult()] })

        const extractResults = createMockExtractResults({
          question: ['first question', 'second question']
        })

        const result = await orchestrator.processWebsearch(createMockProvider(), extractResults, 'request-1')

        expect(result.query).toBe('first question | second question')
      })
    })
  })
})
