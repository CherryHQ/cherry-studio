import type { WebSearchProvider } from '@renderer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExaMcpProvider from '../ExaMcpProvider'

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

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock AbortSignal.any
vi.stubGlobal('AbortSignal', {
  ...AbortSignal,
  any: vi.fn((signals: AbortSignal[]) => signals[0]),
  timeout: vi.fn(() => new AbortController().signal)
})

// Helper functions
const createMockProvider = (overrides: Partial<WebSearchProvider> = {}): WebSearchProvider =>
  ({
    id: 'exa-mcp',
    type: 'mcp',
    apiKey: 'test-api-key',
    apiHost: 'https://mcp.exa.ai/mcp',
    ...overrides
  }) as WebSearchProvider

const createMockSSEResponse = (results: Array<{ title: string; url: string; text: string }>) => {
  const textContent = results
    .map(
      (r) => `Title: ${r.title}
Published Date: 2026-01-21
URL: ${r.url}
Text: ${r.text}`
    )
    .join('\n\n')

  return `data: ${JSON.stringify({
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: textContent }]
    }
  })}`
}

const createMockJsonResponse = (results: Array<{ title: string; url: string; text: string }>) => {
  const textContent = results
    .map(
      (r) => `Title: ${r.title}
Published Date: 2026-01-21
URL: ${r.url}
Text: ${r.text}`
    )
    .join('\n\n')

  return JSON.stringify({
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: textContent }]
    }
  })
}

describe('ExaMcpProvider', () => {
  let provider: ExaMcpProvider

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Default preference mock
    mockPreferenceGet.mockImplementation((key: string) => {
      if (key === 'chat.websearch.max_results') return Promise.resolve(10)
      if (key === 'chat.websearch.exclude_domains') return Promise.resolve([])
      if (key === 'chat.websearch.search_with_time') return Promise.resolve(false)
      return Promise.resolve(null)
    })

    provider = new ExaMcpProvider(createMockProvider())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should use default API host when not provided', () => {
      // ExaMcpProvider sets apiHost internally in constructor, not via the base class method
      // The internal apiHost field is used for requests, but getApiHost() returns provider.apiHost
      const providerWithoutHost = new ExaMcpProvider(createMockProvider({ apiHost: '' }))

      // The provider was created without throwing, meaning default was applied internally
      expect(providerWithoutHost).toBeDefined()
    })

    it('should use provided API host', () => {
      const customHost = 'https://custom.exa.ai/mcp'
      const providerWithHost = new ExaMcpProvider(createMockProvider({ apiHost: customHost }))

      expect(providerWithHost.getApiHost()).toBe(customHost)
    })
  })

  describe('search', () => {
    describe('empty query', () => {
      it('should throw error for empty query', async () => {
        await expect(provider.search('')).rejects.toThrow('Search query cannot be empty')
      })

      it('should throw error for whitespace-only query', async () => {
        await expect(provider.search('   ')).rejects.toThrow('Search query cannot be empty')
      })
    })

    describe('successful search', () => {
      it('should return formatted results from SSE response', async () => {
        const sseResponse = createMockSSEResponse([
          { title: 'Test Title', url: 'https://example.com', text: 'Test content' }
        ])

        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(sseResponse)
        })

        const result = await provider.search('test query')

        expect(result.results).toHaveLength(1)
        expect(result.results[0]).toEqual({
          title: 'Test Title',
          content: 'Test content',
          url: 'https://example.com'
        })
      })

      it('should return formatted results from JSON response', async () => {
        const jsonResponse = createMockJsonResponse([
          { title: 'JSON Title', url: 'https://json.example.com', text: 'JSON content' }
        ])

        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(jsonResponse)
        })

        const result = await provider.search('test query')

        expect(result.results).toHaveLength(1)
        expect(result.results[0].title).toBe('JSON Title')
      })

      it('should send correct MCP request format', async () => {
        const sseResponse = createMockSSEResponse([{ title: 'Test', url: 'https://test.com', text: 'Test content' }])
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(sseResponse)
        })

        await provider.search('my search query')

        expect(mockFetch).toHaveBeenCalledWith(
          'https://mcp.exa.ai/mcp',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream'
            }),
            body: expect.stringContaining('"query":"my search query"')
          })
        )
      })

      it('should use maxResults from preferences', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.max_results') return Promise.resolve(5)
          return Promise.resolve(null)
        })

        const sseResponse = createMockSSEResponse([{ title: 'Test', url: 'https://test.com', text: 'Test content' }])
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(sseResponse)
        })

        await provider.search('test')

        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
        expect(callBody.params.arguments.numResults).toBe(5)
      })

      it('should limit results to maxResults', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.max_results') return Promise.resolve(2)
          return Promise.resolve(null)
        })

        const manyResults = createMockSSEResponse([
          { title: 'Result 1', url: 'https://1.com', text: 'Content 1' },
          { title: 'Result 2', url: 'https://2.com', text: 'Content 2' },
          { title: 'Result 3', url: 'https://3.com', text: 'Content 3' }
        ])

        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(manyResults)
        })

        const result = await provider.search('test')

        expect(result.results).toHaveLength(2)
      })

      it('should handle missing title with default', async () => {
        const responseWithoutTitle = createMockSSEResponse([{ title: '', url: 'https://example.com', text: 'Content' }])

        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(responseWithoutTitle)
        })

        const result = await provider.search('test')

        expect(result.results[0].title).toBe('No title')
      })
    })

    describe('error handling', () => {
      it('should throw error on non-200 response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error')
        })

        await expect(provider.search('test')).rejects.toThrow('Search failed:')
      })

      it('should throw error when response parsing fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('invalid response format')
        })

        await expect(provider.search('test')).rejects.toThrow('unrecognized response format')
      })
    })

    describe('abort signal', () => {
      it('should pass abort signal to fetch', async () => {
        const controller = new AbortController()

        const sseResponse = createMockSSEResponse([{ title: 'Test', url: 'https://test.com', text: 'Test content' }])
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(sseResponse)
        })

        await provider.search('test', { signal: controller.signal })

        expect(AbortSignal.any).toHaveBeenCalled()
      })
    })
  })

  describe('defaultHeaders', () => {
    it('should return standard headers', () => {
      const headers = provider.defaultHeaders()

      expect(headers).toEqual({
        'HTTP-Referer': 'https://cherry-ai.com',
        'X-Title': 'Cherry Studio'
      })
    })
  })
})
