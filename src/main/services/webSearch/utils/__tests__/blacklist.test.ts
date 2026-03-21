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

    const filtered = filterWebSearchResponseWithBlacklist(response, ['https://blocked.example/*', '/evil\\.example$/'])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed',
        content: 'ok',
        url: 'https://allowed.example/post'
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
})
