import type { WebSearchState } from '@renderer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BochaProvider from '../BochaProvider'
import QueritProvider from '../QueritProvider'

const baseWebSearchState: WebSearchState = {
  defaultProvider: null,
  providers: [],
  searchWithTime: true,
  maxResults: 4,
  excludeDomains: ['example.com'],
  subscribeSources: [],
  compressionConfig: {
    method: 'none',
    cutoffLimit: 2000,
    cutoffUnit: 'char'
  }
}

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response
}

describe('renderer web search provider request shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps searchWithTime to Bocha freshness', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        code: 200,
        data: {
          queryContext: {
            originalQuery: 'hello'
          },
          webPages: {
            value: []
          }
        }
      })
    )

    const provider = new BochaProvider({
      id: 'bocha',
      name: 'Bocha',
      apiKey: 'bocha-key',
      apiHost: 'https://api.bochaai.com'
    })

    await provider.search('hello', baseWebSearchState)

    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(request?.body as string)).toEqual(
      expect.objectContaining({
        freshness: 'oneDay'
      })
    )
  })

  it('maps searchWithTime to Querit timeRange filter', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        error_code: 200,
        query_context: {
          query: 'hello'
        },
        results: {
          result: []
        }
      })
    )

    const provider = new QueritProvider({
      id: 'querit',
      name: 'Querit',
      apiKey: 'querit-key',
      apiHost: 'https://api.querit.ai'
    })

    await provider.search('hello', baseWebSearchState)

    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(request?.body as string)).toEqual(
      expect.objectContaining({
        filters: expect.objectContaining({
          timeRange: { date: 'd1' }
        })
      })
    )
  })
})
