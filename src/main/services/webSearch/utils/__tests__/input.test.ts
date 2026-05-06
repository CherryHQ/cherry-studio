import { describe, expect, it } from 'vitest'

import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from '../input'

describe('webSearch input utils', () => {
  it('trims keywords and drops empty entries', () => {
    expect(normalizeWebSearchKeywords([' first ', '', '  second\n'])).toEqual(['first', 'second'])
  })

  it('throws when keywords are empty after normalization', () => {
    expect(() => normalizeWebSearchKeywords([' ', '\n'])).toThrow('At least one web search keyword is required')
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
    expect(() => normalizeWebSearchUrls(['https://example.com', 'not a url'])).toThrow('Invalid URL format: not a url')
  })
})
