import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { filterWebSearchResponseWithBlacklist } from '../blacklist'

describe('filterWebSearchResponseWithBlacklist', () => {
  it('filters results by regex and match-pattern blacklist rules', () => {
    const response: WebSearchResponse = {
      query: 'hello',
      results: [
        {
          title: 'Blocked by match pattern',
          content: 'blocked',
          url: 'https://blocked.example/article'
        },
        {
          title: 'Blocked by regex',
          content: 'blocked',
          url: 'https://evil.example/path'
        },
        {
          title: 'Allowed',
          content: 'ok',
          url: 'https://allowed.example/post'
        }
      ]
    }

    const filtered = filterWebSearchResponseWithBlacklist(response, [
      'https://blocked.example/*',
      '/evil\\.example\\/path$/'
    ])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed',
        content: 'ok',
        url: 'https://allowed.example/post'
      }
    ])
  })

  it('matches regex blacklist patterns against the full URL', () => {
    const response: WebSearchResponse = {
      query: 'hello',
      results: [
        {
          title: 'Blocked by regex path',
          content: 'blocked',
          url: 'https://evil.example/malicious-path'
        },
        {
          title: 'Allowed other path',
          content: 'ok',
          url: 'https://evil.example/other-path'
        }
      ]
    }

    const filtered = filterWebSearchResponseWithBlacklist(response, ['/evil\\.example\\/malicious-path$/'])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed other path',
        content: 'ok',
        url: 'https://evil.example/other-path'
      }
    ])
  })

  it('ignores invalid patterns and preserves malformed result urls', () => {
    const response: WebSearchResponse = {
      query: 'hello',
      results: [
        {
          title: 'Malformed URL',
          content: 'kept',
          url: 'not-a-valid-url'
        }
      ]
    }

    const filtered = filterWebSearchResponseWithBlacklist(response, ['invalid pattern', '/[broken/'])

    expect(filtered.results).toEqual(response.results)
  })

  it('matches wildcard host and path patterns with linear matching', () => {
    const response: WebSearchResponse = {
      query: 'hello',
      results: [
        {
          title: 'Blocked subdomain',
          content: 'blocked',
          url: 'https://docs.example.com/guide/install'
        },
        {
          title: 'Blocked root domain',
          content: 'blocked',
          url: 'https://example.com/guide/install'
        },
        {
          title: 'Allowed different path',
          content: 'ok',
          url: 'https://example.com/blog/post'
        }
      ]
    }

    const filtered = filterWebSearchResponseWithBlacklist(response, ['https://*.example.com/guide/*'])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed different path',
        content: 'ok',
        url: 'https://example.com/blog/post'
      }
    ])
  })
})
