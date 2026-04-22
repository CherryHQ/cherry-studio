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
    vi.mocked(WebSearchService.getWebSearchProvider).mockReturnValue({ id: 'local-google' } as any)
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
      'local-google',
      {
        question: [' first ', 'FIRST', 'second', 'third', 'fourth']
      },
      'request-1'
    ) as any

    const firstResult = await searchTool.execute({})
    const secondResult = await searchTool.execute({ additionalContext: 'new context' })

    expect(WebSearchService.processWebsearch).toHaveBeenCalledTimes(1)
    expect(WebSearchService.processWebsearch).toHaveBeenCalledWith(
      { id: 'local-google' },
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

    expect(modelText).toContain('Cite them as [1], [2], etc.')
    expect(modelText).toContain('"url": "https://example.com"')
    expect(modelText).not.toContain('REFERENCE_PROMPT')
    expect(modelText).not.toContain('utm_source')
  })
})
