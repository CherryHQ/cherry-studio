import { describe, expect, it } from 'vitest'

import { MAX_WEB_SEARCH_INPUTS, normalizeWebSearchKeywords, normalizeWebSearchUrls } from '../input'

describe('webSearch input utils', () => {
  it('trims keywords and drops empty entries', () => {
    expect(normalizeWebSearchKeywords([' first ', '', '  second\n'])).toEqual(['first', 'second'])
  })

  it('throws when keywords are empty after normalization', () => {
    expect(() => normalizeWebSearchKeywords([' ', '\n'])).toThrow('At least one web search keyword is required')
  })

  it('throws when keyword count exceeds the per-request limit', () => {
    expect(() =>
      normalizeWebSearchKeywords(Array.from({ length: MAX_WEB_SEARCH_INPUTS + 1 }, (_, index) => `${index}`))
    ).toThrow(`Web search supports at most ${MAX_WEB_SEARCH_INPUTS} inputs per request`)
  })

  it('trims URLs and drops empty entries', () => {
    expect(normalizeWebSearchUrls([' https://example.com/one ', '', '\nhttps://example.com/two\n'])).toEqual([
      'https://example.com/one',
      'https://example.com/two'
    ])
  })

  it('throws when URLs are empty after normalization', () => {
    expect(() => normalizeWebSearchUrls([' ', '\n'])).toThrow('At least one URL is required')
  })

  it('throws for invalid URLs', () => {
    expect(() => normalizeWebSearchUrls(['https://example.com', 'not a url', 'also invalid'])).toThrow(
      'Invalid URL format: not a url, also invalid'
    )
  })

  it.each([
    'https://user:pass@example.com/file',
    'http://localhost:3000/file',
    'http://127.0.0.1/file',
    'http://10.0.0.1/file',
    'http://169.254.169.254/latest/meta-data/'
  ])('throws for unsafe remote URLs before provider dispatch: %s', (url) => {
    expect(() => normalizeWebSearchUrls([url])).toThrow(/Unsafe remote url/)
  })

  it('throws when URL count exceeds the per-request limit', () => {
    expect(() =>
      normalizeWebSearchUrls(
        Array.from({ length: MAX_WEB_SEARCH_INPUTS + 1 }, (_, index) => `https://example.com/${index}`)
      )
    ).toThrow(`Web search supports at most ${MAX_WEB_SEARCH_INPUTS} inputs per request`)
  })
})
