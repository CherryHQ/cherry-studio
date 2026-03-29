import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock, kyCreateMock, axiosGetMock, fetchWebContentMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  kyCreateMock: vi.fn(() => ({ extend: vi.fn(() => ({})) })),
  axiosGetMock: vi.fn(),
  fetchWebContentMock: vi.fn()
}))

vi.mock('@agentic/searxng', () => ({
  SearxngClient: vi.fn(() => ({
    search: searchMock
  }))
}))

vi.mock('ky', () => ({
  default: {
    create: kyCreateMock
  }
}))

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock
  }
}))

vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContent: fetchWebContentMock,
  noContent: 'No content found'
}))

import SearxngProvider from './SearxngProvider'

describe('SearxngProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    global.window = {
      keyv: {
        get: vi.fn(),
        set: vi.fn()
      }
    } as any

    axiosGetMock.mockResolvedValue({
      data: {
        engines: [{ enabled: true, categories: ['general', 'web'], name: 'google' }]
      }
    })

    searchMock.mockResolvedValue({
      results: [
        {
          title: 'Relevant result',
          url: 'https://example.com/result',
          content: 'Snippet from SearXNG'
        }
      ]
    })
  })

  it('falls back to the SearXNG snippet when page fetching returns no content', async () => {
    fetchWebContentMock.mockResolvedValue({
      title: 'Fetched page',
      url: 'https://example.com/result',
      content: 'No content found'
    })

    const provider = new SearxngProvider({
      id: 'searxng',
      name: 'SearXNG',
      apiHost: 'https://searx.example.com'
    })

    const response = await provider.search('test query', { maxResults: 10 } as any)

    expect(response.results).toEqual([
      {
        title: 'Relevant result',
        url: 'https://example.com/result',
        content: 'Snippet from SearXNG'
      }
    ])
  })

  it('falls back to the SearXNG snippet when page fetching throws', async () => {
    fetchWebContentMock.mockRejectedValue(new Error('timeout'))

    const provider = new SearxngProvider({
      id: 'searxng',
      name: 'SearXNG',
      apiHost: 'https://searx.example.com'
    })

    const response = await provider.search('test query', { maxResults: 10 } as any)

    expect(response.results).toEqual([
      {
        title: 'Relevant result',
        url: 'https://example.com/result',
        content: 'Snippet from SearXNG'
      }
    ])
  })

  it('keeps fetched content when readable page extraction succeeds', async () => {
    fetchWebContentMock.mockResolvedValue({
      title: 'Fetched page',
      url: 'https://example.com/result',
      content: 'Fetched markdown content'
    })

    const provider = new SearxngProvider({
      id: 'searxng',
      name: 'SearXNG',
      apiHost: 'https://searx.example.com'
    })

    const response = await provider.search('test query', { maxResults: 10 } as any)

    expect(response.results).toEqual([
      {
        title: 'Fetched page',
        url: 'https://example.com/result',
        content: 'Fetched markdown content'
      }
    ])
  })
})
