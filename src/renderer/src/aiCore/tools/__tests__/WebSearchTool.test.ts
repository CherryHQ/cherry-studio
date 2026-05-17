import WebSearchService from '@renderer/services/WebSearchService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { webSearchToolWithPreExtractedKeywords } from '../WebSearchTool'

vi.mock('@renderer/services/WebSearchService', () => ({
  default: {
    getWebSearchProvider: vi.fn(),
    processWebsearch: vi.fn()
  }
}))

describe('webSearchToolWithPreExtractedKeywords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(WebSearchService.getWebSearchProvider).mockReturnValue({ id: 'tavily' } as any)
    vi.mocked(WebSearchService.processWebsearch).mockResolvedValue({
      query: 'first | second',
      results: [
        {
          title: 'Result',
          content: 'Content',
          url: 'https://example.com/path?utm_source=newsletter#details'
        }
      ]
    })
  })

  it('deduplicates queries, limits them, keeps full URLs in output, and shortens model URLs', async () => {
    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: [' first ', 'FIRST', 'second', 'third', 'fourth']
      },
      'request-1'
    ) as any

    const result = await searchTool.execute({})

    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(WebSearchService.processWebsearch).toHaveBeenCalledWith(
      { id: 'tavily' },
      {
        websearch: {
          question: ['first', 'second', 'third'],
          links: undefined
        }
      },
      'request-1',
      undefined
    )
    expect(result.results[0].url).toBe('https://example.com/path?utm_source=newsletter#details')

    const modelOutput = searchTool.toModelOutput({ output: result })
    const modelText = modelOutput.value.map((part: { text: string }) => part.text).join('\n')

    expect(modelText).toContain('"url": "https://example.com"')
    expect(modelText).not.toContain('utm_source')
  })

  it('reuses cached result for identical queries', async () => {
    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: ['test query']
      },
      'request-1'
    ) as any

    const firstResult = await searchTool.execute({})
    const secondResult = await searchTool.execute({})

    // Same queries + no additionalContext = cache hit
    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(firstResult).toBe(secondResult)
  })

  it('does not reuse cache when additionalContext produces different queries', async () => {
    vi.mocked(WebSearchService.processWebsearch).mockResolvedValue({
      query: 'result',
      results: [{ title: 'R', content: 'C', url: 'https://example.com' }]
    })

    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: ['original']
      },
      'request-1'
    ) as any

    await searchTool.execute({})
    await searchTool.execute({ additionalContext: 'different context' })

    // Different finalQueries = separate cache entries
    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(2)
  })

  it('does not reuse cache when fullContent mode differs', async () => {
    vi.mocked(WebSearchService.processWebsearch).mockResolvedValue({
      query: 'result',
      results: [{ title: 'R', content: 'C', url: 'https://example.com' }]
    })

    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: ['test']
      },
      'request-1'
    ) as any

    await searchTool.execute({})
    await searchTool.execute({ fullContent: true })

    // fullContent=false vs fullContent=true = separate cache entries
    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(2)
    expect(WebSearchService.processWebsearch).toHaveBeenNthCalledWith(
      1,
      { id: 'tavily' },
      expect.anything(),
      'request-1',
      undefined
    )
    expect(WebSearchService.processWebsearch).toHaveBeenNthCalledWith(
      2,
      { id: 'tavily' },
      expect.anything(),
      'request-1',
      true
    )
  })

  it('reuses cache for same fullContent mode', async () => {
    vi.mocked(WebSearchService.processWebsearch).mockResolvedValue({
      query: 'result',
      results: [{ title: 'R', content: 'C', url: 'https://example.com' }]
    })

    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: ['test']
      },
      'request-1'
    ) as any

    await searchTool.execute({ fullContent: true })
    await searchTool.execute({ fullContent: true })

    // Same fullContent mode = cache hit
    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(1)
  })

  it('reuses in-flight search request for concurrent executions', async () => {
    const searchResponse = {
      query: 'first',
      results: [
        {
          title: 'Result',
          content: 'Content',
          url: 'https://example.com/path?utm_source=newsletter#details'
        }
      ]
    }
    vi.mocked(WebSearchService.processWebsearch).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(searchResponse), 0))
    )

    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      {
        question: ['first']
      },
      'request-1'
    ) as any

    const [firstResult, secondResult] = await Promise.all([
      searchTool.execute({ additionalContext: 'first context' }),
      searchTool.execute({ additionalContext: 'first context' })
    ])

    // Concurrent calls with same cache key = single search
    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(firstResult).toBe(searchResponse)
    expect(secondResult).toBe(searchResponse)
  })
})
