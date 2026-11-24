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

afterEach(() => vi.restoreAllMocks())

describe('searchWeb', () => {
  it('assigns disjoint id sets across calls', async () => {
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
