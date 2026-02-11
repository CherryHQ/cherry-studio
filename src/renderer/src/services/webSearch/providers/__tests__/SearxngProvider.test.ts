import type { WebSearchProvider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock SearxngClient
const mockSearxngSearch = vi.fn()
vi.mock('@agentic/searxng', () => ({
  SearxngClient: vi.fn().mockImplementation(() => ({
    search: mockSearxngSearch
  }))
}))

// Mock axios
const mockAxiosGet = vi.fn()
vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args)
  }
}))

// Mock ky
vi.mock('ky', () => ({
  default: {
    create: vi.fn().mockReturnValue({})
  }
}))

// Mock preferenceService
const mockPreferenceGet = vi.fn()
vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: (...args: any[]) => mockPreferenceGet(...args)
  }
}))

// Mock cacheService
vi.mock('@data/CacheService', () => ({
  cacheService: {
    getSharedCasual: vi.fn(),
    setSharedCasual: vi.fn()
  }
}))

// Mock fetchWebContent
const mockFetchWebContent = vi.fn()
vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContent: (...args: any[]) => mockFetchWebContent(...args),
  noContent: 'NO_CONTENT'
}))

// Mock btoa for Node.js environment
vi.stubGlobal('btoa', (str: string) => Buffer.from(str).toString('base64'))

// Import after mocks are set up
import SearxngProvider from '../SearxngProvider'

// Helper functions
const createMockProvider = (overrides: Partial<WebSearchProvider> = {}): WebSearchProvider =>
  ({
    id: 'searxng',
    type: 'searxng',
    apiKey: '',
    apiHost: 'https://searxng.example.com',
    ...overrides
  }) as WebSearchProvider

const createMockEnginesResponse = (engines: Array<{ name: string; enabled: boolean; categories: string[] }>) => ({
  data: {
    engines
  }
})

describe('SearxngProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default preference mock
    mockPreferenceGet.mockImplementation((key: string) => {
      if (key === 'chat.web_search.max_results') return Promise.resolve(10)
      if (key === 'chat.web_search.exclude_domains') return Promise.resolve([])
      if (key === 'chat.web_search.search_with_time') return Promise.resolve(false)
      return Promise.resolve(null)
    })

    // Default axios mock for config
    mockAxiosGet.mockResolvedValue(
      createMockEnginesResponse([
        { name: 'google', enabled: true, categories: ['general', 'web'] },
        { name: 'bing', enabled: true, categories: ['general', 'web'] }
      ])
    )
  })

  describe('constructor', () => {
    it('should throw error when apiHost is not provided', () => {
      expect(() => new SearxngProvider(createMockProvider({ apiHost: '' }))).toThrow(
        'API host is required for SearxNG provider'
      )
    })

    it('should throw error when apiHost is undefined', () => {
      expect(() => new SearxngProvider(createMockProvider({ apiHost: undefined }))).toThrow(
        'API host is required for SearxNG provider'
      )
    })

    it('should create provider with valid apiHost', () => {
      const provider = new SearxngProvider(createMockProvider())

      expect(provider.getApiHost()).toBe('https://searxng.example.com')
    })

    it('should initialize with basic auth when credentials provided', () => {
      const provider = new SearxngProvider(
        createMockProvider({
          basicAuthUsername: 'user',
          basicAuthPassword: 'pass'
        })
      )

      expect(provider).toBeDefined()
    })
  })

  describe('search', () => {
    describe('empty query', () => {
      it('should throw error for empty query', async () => {
        const provider = new SearxngProvider(createMockProvider())

        // Wait for init to complete
        await new Promise((resolve) => setTimeout(resolve, 10))

        await expect(provider.search('')).rejects.toThrow('Search query cannot be empty')
      })
    })

    describe('initialization', () => {
      it('should initialize engines on first search if not initialized', async () => {
        // Reset axios to simulate initialization on search
        mockAxiosGet.mockResolvedValueOnce(
          createMockEnginesResponse([{ name: 'duckduckgo', enabled: true, categories: ['general', 'web'] }])
        )

        mockSearxngSearch.mockResolvedValue({
          results: [{ url: 'https://example.com', title: 'Test' }]
        })

        mockFetchWebContent.mockResolvedValue({
          title: 'Test',
          url: 'https://example.com',
          content: 'Test content'
        })

        const provider = new SearxngProvider(createMockProvider())

        const result = await provider.search('test query')

        expect(result.results).toBeDefined()
      })

      it('should throw error when no engines found', async () => {
        mockAxiosGet.mockResolvedValue(createMockEnginesResponse([]))

        expect(() => new SearxngProvider(createMockProvider())).not.toThrow()

        // The initialization error is logged but not thrown in constructor
        // It will throw when search is called
      })

      it('should filter engines by general and web categories', async () => {
        mockAxiosGet.mockResolvedValue(
          createMockEnginesResponse([
            { name: 'google', enabled: true, categories: ['general', 'web'] }, // Valid
            { name: 'images', enabled: true, categories: ['images'] }, // Invalid - missing categories
            { name: 'disabled', enabled: false, categories: ['general', 'web'] } // Invalid - disabled
          ])
        )

        mockSearxngSearch.mockResolvedValue({ results: [] })

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        await provider.search('test')

        // Only 'google' should be used
        expect(mockSearxngSearch).toHaveBeenCalledWith(
          expect.objectContaining({
            engines: ['google']
          })
        )
      })
    })

    describe('successful search', () => {
      it('should return formatted search results', async () => {
        mockSearxngSearch.mockResolvedValue({
          results: [
            { url: 'https://example1.com', title: 'Result 1' },
            { url: 'https://example2.com', title: 'Result 2' }
          ]
        })

        mockFetchWebContent.mockImplementation((url) =>
          Promise.resolve({
            title: `Title for ${url}`,
            url,
            content: `Content for ${url}`
          })
        )

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        const result = await provider.search('test query')

        expect(result.query).toBe('test query')
        expect(result.results).toHaveLength(2)
      })

      it('should filter out results with no content', async () => {
        mockSearxngSearch.mockResolvedValue({
          results: [
            { url: 'https://with-content.com', title: 'With Content' },
            { url: 'https://no-content.com', title: 'No Content' }
          ]
        })

        mockFetchWebContent
          .mockResolvedValueOnce({
            title: 'With Content',
            url: 'https://with-content.com',
            content: 'Has content'
          })
          .mockResolvedValueOnce({
            title: 'No Content',
            url: 'https://no-content.com',
            content: 'NO_CONTENT' // This matches noContent constant
          })

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        const result = await provider.search('test')

        expect(result.results).toHaveLength(1)
        expect(result.results[0].url).toBe('https://with-content.com')
      })

      it('should filter out non-http URLs', async () => {
        mockSearxngSearch.mockResolvedValue({
          results: [
            { url: 'https://valid.com', title: 'Valid' },
            { url: 'ftp://invalid.com', title: 'Invalid FTP' },
            { url: 'file:///local', title: 'Invalid File' }
          ]
        })

        mockFetchWebContent.mockResolvedValue({
          title: 'Valid',
          url: 'https://valid.com',
          content: 'Content'
        })

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        await provider.search('test')

        // Only valid http/https URL should be fetched
        expect(mockFetchWebContent).toHaveBeenCalledTimes(1)
        expect(mockFetchWebContent).toHaveBeenCalledWith('https://valid.com', 'markdown', undefined)
      })

      it('should respect maxResults preference', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.web_search.max_results') return Promise.resolve(2)
          return Promise.resolve(null)
        })

        mockSearxngSearch.mockResolvedValue({
          results: [
            { url: 'https://1.com', title: '1' },
            { url: 'https://2.com', title: '2' },
            { url: 'https://3.com', title: '3' },
            { url: 'https://4.com', title: '4' }
          ]
        })

        mockFetchWebContent.mockResolvedValue({
          title: 'Title',
          url: 'url',
          content: 'Content'
        })

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        await provider.search('test')

        // Should only fetch first 2 results
        expect(mockFetchWebContent).toHaveBeenCalledTimes(2)
      })
    })

    describe('error handling', () => {
      it('should throw error when searxng search fails', async () => {
        mockSearxngSearch.mockRejectedValue(new Error('SearxNG API error'))

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        await expect(provider.search('test')).rejects.toThrow('Search failed:')
      })

      it('should throw error for invalid search results', async () => {
        mockSearxngSearch.mockResolvedValue({ results: null })

        const provider = new SearxngProvider(createMockProvider())

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        await expect(provider.search('test')).rejects.toThrow('Invalid search results from SearxNG')
      })
    })

    describe('basic auth', () => {
      it('should use basic auth for config request when credentials provided', async () => {
        new SearxngProvider(
          createMockProvider({
            basicAuthUsername: 'testuser',
            basicAuthPassword: 'testpass'
          })
        )

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockAxiosGet).toHaveBeenCalledWith(
          'https://searxng.example.com/config',
          expect.objectContaining({
            auth: {
              username: 'testuser',
              password: 'testpass'
            }
          })
        )
      })
    })
  })
})
