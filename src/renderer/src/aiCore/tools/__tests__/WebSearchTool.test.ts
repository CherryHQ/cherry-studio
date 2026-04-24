import { webSearchService } from '@renderer/services/WebSearchService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { webSearchToolWithPreExtractedKeywords } from '../WebSearchTool'

vi.mock('@renderer/services/WebSearchService', () => ({
  webSearchService: {
    getWebSearchProvider: vi.fn(),
    processWebsearch: vi.fn()
  }
}))

describe('webSearchToolWithPreExtractedKeywords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(webSearchService.getWebSearchProvider).mockReturnValue({ id: 'tavily' } as any)
    vi.mocked(webSearchService.processWebsearch).mockResolvedValue({
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

    const firstResult = await searchTool.execute({})
    const secondResult = await searchTool.execute({ additionalContext: 'new context' })

    expect(webSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(webSearchService.processWebsearch).toHaveBeenCalledWith(
      { id: 'tavily' },
      {
        websearch: {
          question: ['first', 'second', 'third'],
          links: undefined
        }
      },
      'request-1'
    )
    expect(firstResult.results[0].url).toBe('https://example.com/path?utm_source=newsletter#details')
    expect(secondResult).toBe(firstResult)

    const modelOutput = searchTool.toModelOutput({ output: firstResult })
    const modelText = modelOutput.value.map((part: { text: string }) => part.text).join('\n')

    expect(modelText).toContain('"url": "https://example.com"')
    expect(modelText).not.toContain('utm_source')
  })

  it('reuses the in-flight search request for concurrent executions', async () => {
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
    vi.mocked(webSearchService.processWebsearch).mockImplementation(
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
      searchTool.execute({ additionalContext: 'second context' })
    ])

    expect(webSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(webSearchService.processWebsearch).toHaveBeenCalledWith(
      { id: 'tavily' },
      {
        websearch: {
          question: ['first context'],
          links: undefined
        }
      },
      'request-1'
    )
    expect(firstResult).toBe(searchResponse)
    expect(secondResult).toBe(searchResponse)
  })
})
