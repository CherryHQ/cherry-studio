import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { webSearchHandlers } from '../webSearch'

const webSearchService = {
  searchKeywords: vi.fn(),
  fetchUrls: vi.fn()
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

describe('webSearchHandlers', () => {
  it('search_keywords forwards the request and resolves void (the response is not surfaced over IPC)', async () => {
    const request = { providerId: 'tavily' as const, keywords: ['hello'] }
    webSearchService.searchKeywords.mockResolvedValue({
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['hello'],
      results: []
    })

    const result = await webSearchHandlers['web_search.search_keywords'](request, ctx)

    expect(webSearchService.searchKeywords).toHaveBeenCalledWith(request)
    expect(result).toBeUndefined()
  })

  it('fetch_urls forwards the request and resolves void (the response is not surfaced over IPC)', async () => {
    const request = { providerId: 'fetch' as const, urls: ['https://example.com'] }
    webSearchService.fetchUrls.mockResolvedValue({
      providerId: 'fetch',
      capability: 'fetchUrls',
      inputs: ['https://example.com'],
      results: []
    })

    const result = await webSearchHandlers['web_search.fetch_urls'](request, ctx)

    expect(webSearchService.fetchUrls).toHaveBeenCalledWith(request)
    expect(result).toBeUndefined()
  })

  // The renderer's "check" flow relies on the IPC call REJECTING to show a failure
  // toast; the void output must not turn a failing service call into a false success.
  // These pin the adapter's `await` (a fire-and-forget regression would swallow it).
  it('search_keywords rejects when the service throws (failure surfaces as an IPC rejection)', async () => {
    const request = { providerId: 'tavily' as const, keywords: ['hello'] }
    webSearchService.searchKeywords.mockRejectedValue(new Error('missing API key'))

    await expect(webSearchHandlers['web_search.search_keywords'](request, ctx)).rejects.toThrow('missing API key')
  })

  it('fetch_urls rejects when the service throws (failure surfaces as an IPC rejection)', async () => {
    const request = { providerId: 'fetch' as const, urls: ['https://example.com'] }
    webSearchService.fetchUrls.mockRejectedValue(new Error('unreachable host'))

    await expect(webSearchHandlers['web_search.fetch_urls'](request, ctx)).rejects.toThrow('unreachable host')
  })
})
