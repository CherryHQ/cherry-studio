import type { WebSearchProviderResponse } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWebSearchProviderAsync: vi.fn(),
  processWebsearch: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@renderer/services/WebSearchService', () => ({
  webSearchService: {
    getWebSearchProviderAsync: mocks.getWebSearchProviderAsync,
    processWebsearch: mocks.processWebsearch
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      warn: mocks.loggerWarn
    }))
  }
}))

import { webSearchToolWithPreExtractedKeywords } from '../WebSearchTool'

describe('webSearchToolWithPreExtractedKeywords', () => {
  beforeEach(() => {
    mocks.getWebSearchProviderAsync.mockReset()
    mocks.processWebsearch.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.getWebSearchProviderAsync.mockResolvedValue({ id: 'tavily' })
    mocks.processWebsearch.mockResolvedValue({
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

    expect(mocks.processWebsearch).toHaveBeenCalledTimes(1)
    expect(mocks.processWebsearch).toHaveBeenCalledWith(
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
    const searchResponse: WebSearchProviderResponse = {
      query: 'first',
      results: [
        {
          title: 'Result',
          content: 'Content',
          url: 'https://example.com/path?utm_source=newsletter#details'
        }
      ]
    }
    mocks.processWebsearch.mockImplementation(
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

    expect(mocks.processWebsearch).toHaveBeenCalledTimes(1)
    expect(mocks.processWebsearch).toHaveBeenCalledWith(
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

  it('returns an explicit unavailable result when the configured provider is unavailable', async () => {
    mocks.getWebSearchProviderAsync.mockResolvedValue(undefined)

    const searchTool = webSearchToolWithPreExtractedKeywords(
      'tavily',
      { question: ['latest cherry studio'] },
      'request-1'
    )

    const result = await searchTool.execute?.({ additionalContext: undefined }, {} as never)

    expect(result).toEqual({
      query: 'latest cherry studio',
      results: [
        {
          title: 'Web search provider unavailable',
          content: 'Web search provider "tavily" is unavailable, so the prepared search could not be executed.',
          url: 'web-search-provider-unavailable'
        }
      ]
    })

    expect(mocks.processWebsearch).not.toHaveBeenCalled()
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Skip web search because provider is unavailable', {
      webSearchProviderId: 'tavily',
      requestId: 'request-1'
    })

    const modelOutput = (searchTool as any).toModelOutput({ output: result })
    const modelText = modelOutput.value.map((part: { text: string }) => part.text).join('\n')

    expect(modelText).toContain('configured provider is unavailable')
    expect(modelText).not.toContain('No search needed')
  })
})
