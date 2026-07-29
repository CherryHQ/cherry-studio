import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { searchKeywordsMock } = vi.hoisted(() => ({
  searchKeywordsMock: vi.fn<() => Promise<{ results: Array<{ title: string; url: string; content: string }> }>>()
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { searchKeywords: searchKeywordsMock }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

import { searchWeb } from '../webLookup'

const CITE_ID = /^[a-z0-9]{3}-\d+$/

afterEach(() => vi.restoreAllMocks())

describe('searchWeb', () => {
  it('assigns prefixed sequential citation ids within one call', async () => {
    searchKeywordsMock.mockResolvedValueOnce({
      results: [
        { title: 'a', url: 'https://a.com', content: 'A' },
        { title: 'b', url: 'https://b.com', content: 'B' }
      ]
    })
    const output = await searchWeb('query')
    expect(Array.isArray(output)).toBe(true)
    const ids = (output as Array<{ id: string }>).map((r) => r.id)
    ids.forEach((id) => expect(id).toMatch(CITE_ID))
    const prefixes = new Set(ids.map((id) => id.split('-')[0]))
    expect(prefixes.size).toBe(1)
    expect(ids.map((id) => id.split('-')[1])).toEqual(['1', '2'])
  })

  it('assigns disjoint id sets across calls', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1111).mockReturnValueOnce(0.9999)
    const results = [{ title: 'a', url: 'https://a.com', content: 'A' }]
    searchKeywordsMock.mockResolvedValue({ results })
    const first = (await searchWeb('q1')) as Array<{ id: string }>
    const second = (await searchWeb('q2')) as Array<{ id: string }>
    expect(first[0].id).not.toBe(second[0].id)
  })

  it('keeps the error shape on lookup failure', async () => {
    searchKeywordsMock.mockRejectedValueOnce(new Error('provider down'))
    expect(await searchWeb('query')).toEqual({ error: 'provider down', retryable: true })
  })
})
