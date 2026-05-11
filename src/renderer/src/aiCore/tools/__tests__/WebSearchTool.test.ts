import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchUrlsTool, webSearchTool } from '../WebSearchTool'

const mocks = vi.hoisted(() => ({
  searchKeywords: vi.fn(),
  fetchUrls: vi.fn()
}))

beforeEach(() => {
  mocks.searchKeywords.mockReset()
  mocks.fetchUrls.mockReset()
  vi.stubGlobal('window', {
    api: {
      webSearch: {
        searchKeywords: mocks.searchKeywords,
        fetchUrls: mocks.fetchUrls
      }
    }
  })
})

describe('webSearchTool', () => {
  it('deduplicates and limits queries before calling main web search IPC', async () => {
    const response: WebSearchResponse = {
      query: 'first | second | third',
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['first', 'second', 'third'],
      results: [
        {
          title: 'Result',
          content: 'Content',
          url: 'https://example.com/path?utm_source=newsletter#details',
          sourceInput: 'first'
        }
      ]
    }
    mocks.searchKeywords.mockResolvedValue(response)

    const searchTool = webSearchTool() as any
    const result = await searchTool.execute({ queries: [' first ', 'FIRST', 'second', 'third', 'fourth'] })

    expect(mocks.searchKeywords).toHaveBeenCalledWith({ keywords: ['first', 'second', 'third'] })
    expect(result).toBe(response)

    const modelOutput = searchTool.toModelOutput({ output: result })
    const modelText = modelOutput.value.map((part: { text: string }) => part.text).join('\n')

    expect(modelText).toContain('"url": "https://example.com"')
    expect(modelText).not.toContain('utm_source')
  })

  it('accepts legacy additionalContext input as a single query', async () => {
    const response: WebSearchResponse = {
      query: 'latest cherry studio',
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['latest cherry studio'],
      results: []
    }
    mocks.searchKeywords.mockResolvedValue(response)

    const searchTool = webSearchTool() as any
    await searchTool.execute({ additionalContext: ' latest cherry studio ' })

    expect(mocks.searchKeywords).toHaveBeenCalledWith({ keywords: ['latest cherry studio'] })
  })

  it('rejects empty search inputs before calling main web search IPC', async () => {
    const searchTool = webSearchTool() as any

    await expect(searchTool.execute({ queries: [' ', ''] })).rejects.toThrow(
      'Provide at least one search query in `queries` (string array).'
    )

    expect(mocks.searchKeywords).not.toHaveBeenCalled()
  })
})

describe('fetchUrlsTool', () => {
  it('deduplicates URLs before calling main fetch URLs IPC', async () => {
    const response: WebSearchResponse = {
      query: 'https://example.com',
      providerId: 'fetch',
      capability: 'fetchUrls',
      inputs: ['https://example.com'],
      results: [
        {
          title: 'Example',
          content: 'Fetched content',
          url: 'https://example.com',
          sourceInput: 'https://example.com'
        }
      ]
    }
    mocks.fetchUrls.mockResolvedValue(response)

    const fetchTool = fetchUrlsTool() as any
    const result = await fetchTool.execute({ urls: [' https://example.com ', 'https://example.com'] })

    expect(mocks.fetchUrls).toHaveBeenCalledWith({ urls: ['https://example.com'] })
    expect(result).toBe(response)

    const modelOutput = fetchTool.toModelOutput({ output: result })
    const modelText = modelOutput.value.map((part: { text: string }) => part.text).join('\n')

    expect(modelText).toContain('fetches URL content')
    expect(modelText).toContain('"title": "Example"')
  })
})
