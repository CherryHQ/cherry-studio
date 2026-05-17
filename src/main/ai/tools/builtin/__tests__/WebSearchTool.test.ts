import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchUrls, searchKeywords } = vi.hoisted(() => ({
  fetchUrls: vi.fn(),
  searchKeywords: vi.fn()
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { fetchUrls, searchKeywords }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import {
  createWebFetchToolEntry,
  createWebSearchToolEntry,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME
} from '../WebSearchTool'

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

describe('web__search', () => {
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

  it('returns [] when webSearchService throws', async () => {
    searchKeywords.mockRejectedValue(new Error('upstream 503'))
    expect(await callSearchExecute({ query: 'q' })).toEqual([])
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

describe('web__fetch', () => {
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

  it('returns [] when webSearchService throws', async () => {
    fetchUrls.mockRejectedValue(new Error('upstream 503'))
    expect(await callFetchExecute({ urls: ['https://example.com'] })).toEqual([])
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
