import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchUrls, searchKeywords } = vi.hoisted(() => ({
  fetchUrls: vi.fn(),
  searchKeywords: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { fetchUrls, searchKeywords }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { createWebFetchToolEntry } from '../WebFetchTool'
import { createWebSearchToolEntry, WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

const searchEntry = createWebSearchToolEntry()
const fetchEntry = createWebFetchToolEntry()

function makeOptions(abortSignal = new AbortController().signal): ToolExecutionOptions {
  return {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal }
  } as ToolExecutionOptions
}

function response() {
  return {
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['q'],
    results: [
      { title: 'A', url: 'https://a.com', content: 'about A', sourceInput: 'q' },
      { title: 'B', url: 'https://b.com', content: 'about B', sourceInput: 'q' }
    ]
  }
}

function callSearchExecute(args: { query: string }, abortSignal?: AbortSignal): Promise<unknown> {
  const execute = searchEntry.tool.execute as (
    args: { query: string },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

function callFetchExecute(args: { urls: string[] }, abortSignal?: AbortSignal): Promise<unknown> {
  const execute = fetchEntry.tool.execute as (
    args: { urls: string[] },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

describe('web_search', () => {
  beforeEach(() => {
    fetchUrls.mockReset()
    searchKeywords.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(searchEntry.name).toBe(WEB_SEARCH_TOOL_NAME)
    expect(searchEntry.namespace).toBe('web')
    expect(searchEntry.defer).toBe('auto')
  })

  it('calls WebSearchService.searchKeywords with the request abort signal', async () => {
    const abortSignal = new AbortController().signal
    searchKeywords.mockResolvedValue(response())

    await callSearchExecute({ query: 'hello' }, abortSignal)

    expect(searchKeywords).toHaveBeenCalledWith({ keywords: ['hello'] }, { signal: abortSignal })
  })

  it('maps WebSearchResponse to indexed output items', async () => {
    searchKeywords.mockResolvedValue(response())

    const result = await callSearchExecute({ query: 'q' })
    expect(result).toEqual([
      { id: 1, title: 'A', url: 'https://a.com', content: 'about A' },
      { id: 2, title: 'B', url: 'https://b.com', content: 'about B' }
    ])
  })

  it('returns an error discriminant (not []) when webSearchService throws', async () => {
    searchKeywords.mockRejectedValue(new Error('upstream 503'))
    const out = await callSearchExecute({ query: 'q' })
    // Distinguishable from an empty-but-successful search: never [].
    expect(out).toEqual({ error: 'upstream 503', retryable: true })
  })

  it('marks a missing provider as terminal instead of retrying it', async () => {
    const message = 'Default web search provider is not configured for capability searchKeywords'
    searchKeywords.mockRejectedValue(new Error(message))

    expect(await callSearchExecute({ query: 'q' })).toEqual({
      error: message,
      retryable: false,
      terminal: true,
      userMessage:
        'Web search is unavailable because no compatible provider is configured. Configure one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_provider_unavailable'
    })
  })

  it.each([
    ['missing API key', 'API key is required for provider tavily'],
    ['missing API host', 'API host is required for provider tavily capability searchKeywords']
  ])('marks a %s configuration error as terminal instead of retrying it', async (_scenario, message) => {
    searchKeywords.mockRejectedValue(new Error(message))

    expect(await callSearchExecute({ query: 'q' })).toEqual({
      error: message,
      retryable: false,
      terminal: true,
      userMessage:
        'Web search is unavailable because no compatible provider is configured. Configure one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_provider_unavailable'
    })
  })

  it('rethrows an abort instead of converting it to an error discriminant', async () => {
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    searchKeywords.mockRejectedValue(abortError)
    // A cancellation must propagate so the tool loop unwinds — not surface as a retryable provider error.
    await expect(callSearchExecute({ query: 'q' })).rejects.toBe(abortError)
  })

  it('toModelOutput surfaces a retry note on the error path', () => {
    const toModelOutput = searchEntry.tool.toModelOutput!
    const errorView = toModelOutput({ output: { error: 'upstream 503' } } as never)
    expect(errorView).toEqual({
      type: 'text',
      value: 'Web lookup failed (network/provider error); retry or inform the user.'
    })
  })

  it('toModelOutput passes results through as json (incl. the empty case)', () => {
    const toModelOutput = searchEntry.tool.toModelOutput!
    const results = [{ id: 1, title: 'A', url: 'https://a.com', content: 'about A' }]
    expect(toModelOutput({ output: results } as never)).toEqual({ type: 'json', value: results })
    // Empty results are a successful "no matches", NOT the error note.
    expect(toModelOutput({ output: [] } as never)).toEqual({ type: 'json', value: [] })
  })

  describe('applies', () => {
    it('returns true only when assistant.settings.enableWebSearch is set', () => {
      const applies = searchEntry.applies!
      expect(applies({ assistant: undefined, mcpToolIds: new Set() })).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: {} } as never,
          mcpToolIds: new Set()
        })
      ).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: { enableWebSearch: true } } as never,
          mcpToolIds: new Set()
        })
      ).toBe(true)
    })
  })
})

describe('web_fetch', () => {
  beforeEach(() => {
    fetchUrls.mockReset()
    searchKeywords.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(fetchEntry.name).toBe(WEB_FETCH_TOOL_NAME)
    expect(fetchEntry.namespace).toBe('web')
    expect(fetchEntry.defer).toBe('auto')
  })

  it('calls WebSearchService.fetchUrls with the request abort signal', async () => {
    const abortSignal = new AbortController().signal
    fetchUrls.mockResolvedValue(response())

    await callFetchExecute({ urls: ['https://example.com'] }, abortSignal)

    expect(fetchUrls).toHaveBeenCalledWith({ urls: ['https://example.com'] }, { signal: abortSignal })
  })

  it('maps WebSearchResponse to indexed output items', async () => {
    fetchUrls.mockResolvedValue(response())

    const result = await callFetchExecute({ urls: ['https://a.com', 'https://b.com'] })

    expect(result).toEqual([
      { id: 1, title: 'A', url: 'https://a.com', content: 'about A' },
      { id: 2, title: 'B', url: 'https://b.com', content: 'about B' }
    ])
  })

  it('returns an error discriminant (not []) when webSearchService throws', async () => {
    fetchUrls.mockRejectedValue(new Error('upstream 503'))
    const out = await callFetchExecute({ urls: ['https://example.com'] })
    expect(out).toEqual({ error: 'upstream 503', retryable: true })
  })

  it('marks proxy Fake-IP rejection as terminal and tells the model not to retry', async () => {
    const message = 'Unsafe remote url: DNS resolved to local or private address (example.com -> 198.18.1.14)'
    fetchUrls.mockRejectedValue(new Error(message))

    const out = await callFetchExecute({ urls: ['https://example.com'] })

    expect(out).toEqual({
      error: message,
      retryable: false,
      terminal: true,
      userMessage:
        'Web access was blocked because proxy DNS returned a Fake-IP address. Disable the proxy or change its DNS enhanced mode from fake-ip to redir-host, then try again.',
      i18nKey: 'web_search_proxy_fake_ip'
    })
    expect(fetchEntry.tool.toModelOutput!({ output: out } as never)).toEqual({
      type: 'text',
      value:
        'Web access is blocked because proxy DNS returned a Fake-IP address. Tell the user to disable the proxy or change its DNS enhanced mode from fake-ip to redir-host; do not retry until the proxy setting changes.'
    })
  })

  it('rethrows an abort instead of converting it to an error discriminant', async () => {
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    fetchUrls.mockRejectedValue(abortError)
    await expect(callFetchExecute({ urls: ['https://example.com'] })).rejects.toBe(abortError)
  })

  it('toModelOutput surfaces a retry note on the error path', () => {
    const toModelOutput = fetchEntry.tool.toModelOutput!
    const errorView = toModelOutput({ output: { error: 'upstream 503' } } as never)
    expect(errorView).toEqual({
      type: 'text',
      value: 'Web lookup failed (network/provider error); retry or inform the user.'
    })
  })

  describe('applies', () => {
    it('returns true only when assistant.settings.enableWebSearch is set', () => {
      const applies = fetchEntry.applies!
      expect(applies({ assistant: undefined, mcpToolIds: new Set() })).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: {} } as never,
          mcpToolIds: new Set()
        })
      ).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: { enableWebSearch: true } } as never,
          mcpToolIds: new Set()
        })
      ).toBe(true)
    })
  })
})
