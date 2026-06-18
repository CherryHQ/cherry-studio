import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { webSearchHandlers } from '../webSearch'

const webSearchService = {
  searchKeywords: vi.fn(),
  fetchUrls: vi.fn(),
  checkProvider: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WebSearchService') return webSearchService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Web-search handlers ignore IpcContext (they act on shared service state, not the
// caller's window), so the senderId value is irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

const tavilyProvider: WebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  apiKeys: ['key'],
  capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

describe('webSearchHandlers', () => {
  it('search_keywords forwards the request and returns the search response', async () => {
    const request = { providerId: 'tavily' as const, keywords: ['hello'] }
    const response = { providerId: 'tavily', capability: 'searchKeywords', inputs: ['hello'], results: [] }
    webSearchService.searchKeywords.mockResolvedValue(response)

    const result = await webSearchHandlers['web_search.search_keywords'](request, ctx)

    expect(webSearchService.searchKeywords).toHaveBeenCalledWith(request)
    expect(result).toBe(response)
  })

  it('fetch_urls forwards the request and returns the fetch response', async () => {
    const request = { providerId: 'fetch' as const, urls: ['https://example.com'] }
    const response = { providerId: 'fetch', capability: 'fetchUrls', inputs: ['https://example.com'], results: [] }
    webSearchService.fetchUrls.mockResolvedValue(response)

    const result = await webSearchHandlers['web_search.fetch_urls'](request, ctx)

    expect(webSearchService.fetchUrls).toHaveBeenCalledWith(request)
    expect(result).toBe(response)
  })

  it('check_provider forwards the request and returns the validity result', async () => {
    const request = { provider: tavilyProvider }
    const response = { valid: true } as const
    webSearchService.checkProvider.mockResolvedValue(response)

    const result = await webSearchHandlers['web_search.check_provider'](request, ctx)

    expect(webSearchService.checkProvider).toHaveBeenCalledWith(request)
    expect(result).toBe(response)
  })
})
