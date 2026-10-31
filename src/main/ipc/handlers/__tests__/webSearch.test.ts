import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebSearchError, type WebSearchErrorInfo } from '@cherrystudio/web-search'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { webSearchHandlers } from '../webSearch'

const webSearchService = {
  searchKeywords: vi.fn(),
  fetchUrls: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  MockApplicationUtils.resetServices()
  MockApplicationUtils.setService('WebSearchService', webSearchService)
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

    expect(webSearchService.searchKeywords).toHaveBeenCalledWith(request, undefined, { fallback: false })
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

    expect(webSearchService.fetchUrls).toHaveBeenCalledWith(request, undefined, { fallback: false })
    expect(result).toBeUndefined()
  })

  // A rejected check must not become a false success through the void IPC output.
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

  it('exposes an attributable Querit fetch failure as a serializable domain IpcError', async () => {
    webSearchService.fetchUrls.mockRejectedValue(
      new WebSearchError({
        providerId: 'querit',
        capability: 'fetchUrls',
        kind: 'provider',
        code: 'page_fetch_failed',
        message: 'Querit could not fetch page content for https://example.com'
      })
    )
    const error = await webSearchHandlers['web_search.fetch_urls'](
      { providerId: 'querit', urls: ['https://example.com'] },
      ctx
    ).catch((error) => error)

    expect(error).toBeInstanceOf(IpcError)
    expect(IpcError.fromJSON(IpcError.from(error).toJSON()).toJSON()).toEqual({
      code: 'WEB_SEARCH_PAGE_FETCH_FAILED',
      message: 'Querit could not fetch page content for https://example.com'
    })
  })

  it.each<Partial<WebSearchErrorInfo>>([
    { providerId: 'jina' },
    { capability: 'searchKeywords' },
    { kind: 'invalid_response' },
    { kind: 'invalid_response', code: 'empty_content' },
    { code: 'provider_error', providerCode: '401' },
    { kind: 'http', code: 'http_error', status: 401 },
    { kind: 'network', code: 'network_error' }
  ])('does not translate another error context: %j', async (overrides) => {
    const error = new WebSearchError({
      providerId: 'querit',
      capability: 'fetchUrls',
      kind: 'provider',
      code: 'page_fetch_failed',
      message: 'Original diagnostic',
      ...overrides
    })
    webSearchService.fetchUrls.mockRejectedValue(error)
    await expect(
      webSearchHandlers['web_search.fetch_urls']({ providerId: 'querit', urls: ['https://example.com'] }, ctx)
    ).rejects.toBe(error)
  })

  it('does not translate an untyped error carrying the same context fields', async () => {
    const error = Object.assign(new Error('Original diagnostic'), {
      providerId: 'querit',
      capability: 'fetchUrls',
      kind: 'provider',
      code: 'page_fetch_failed'
    })
    webSearchService.fetchUrls.mockRejectedValue(error)
    await expect(
      webSearchHandlers['web_search.fetch_urls']({ providerId: 'querit', urls: ['https://example.com'] }, ctx)
    ).rejects.toBe(error)
  })

  it('does not translate a Querit page error on the search route', async () => {
    const error = new WebSearchError({
      providerId: 'querit',
      capability: 'fetchUrls',
      kind: 'provider',
      code: 'page_fetch_failed',
      message: 'Original diagnostic'
    })
    webSearchService.searchKeywords.mockRejectedValue(error)
    await expect(
      webSearchHandlers['web_search.search_keywords']({ providerId: 'querit', keywords: ['Cherry Studio'] }, ctx)
    ).rejects.toBe(error)
  })
})
