import { describe, expect, it } from 'vitest'

import type { WebSearchResponse, WebSearchResult } from '@shared/data/types/webSearch'

import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'

import { filterWebSearchResponseWithBlacklist, mergeWebSearchBlacklist, toExcludedSiteDomains } from '../blacklist'

function response(results: Array<Omit<WebSearchResult, 'sourceInput'> & { sourceInput?: string }>): WebSearchResponse {
  return {
    query: 'hello',
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['hello'],
    results: results.map((result) => ({
      ...result,
      sourceInput: result.sourceInput || 'hello'
    }))
  }
}

describe('filterWebSearchResponseWithBlacklist', () => {
  it('filters results by regex and match-pattern blacklist rules', () => {
    const webSearchResponse = response([
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
    ])

    const filtered = filterWebSearchResponseWithBlacklist(webSearchResponse, [
      'https://blocked.example/*',
      '/evil\\.example\\/path$/'
    ])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed',
        content: 'ok',
        url: 'https://allowed.example/post',
        sourceInput: 'hello'
      }
    ])
  })

  it('matches regex blacklist patterns against the full URL', () => {
    const webSearchResponse = response([
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
    ])

    const filtered = filterWebSearchResponseWithBlacklist(webSearchResponse, ['/evil\\.example\\/malicious-path$/'])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed other path',
        content: 'ok',
        url: 'https://evil.example/other-path',
        sourceInput: 'hello'
      }
    ])
  })

  it('ignores invalid patterns and preserves malformed result urls', () => {
    const webSearchResponse = response([
      {
        title: 'Malformed URL',
        content: 'kept',
        url: 'not-a-valid-url'
      }
    ])

    const filtered = filterWebSearchResponseWithBlacklist(webSearchResponse, ['invalid pattern', '/[broken/'])

    expect(filtered.results).toEqual(webSearchResponse.results)
  })

  it('matches wildcard host and path patterns with linear matching', () => {
    const webSearchResponse = response([
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
    ])

    const filtered = filterWebSearchResponseWithBlacklist(webSearchResponse, ['https://*.example.com/guide/*'])

    expect(filtered.results).toEqual([
      {
        title: 'Allowed different path',
        content: 'ok',
        url: 'https://example.com/blog/post',
        sourceInput: 'hello'
      }
    ])
  })
})

describe('mergeWebSearchBlacklist', () => {
  function subscription(rules: string[]): WebSearchBlacklistSubscription {
    return { id: 'sub-1', url: 'https://lists.example/list.txt', rules }
  }

  it('returns the manual list unchanged when no subscription exists', () => {
    expect(mergeWebSearchBlacklist(['*://*.manual.example/*'], [])).toEqual(['*://*.manual.example/*'])
  })

  it('merges subscription rules after manual rules, deduplicated', () => {
    const merged = mergeWebSearchBlacklist(
      ['*://*.manual.example/*', '*://*.shared.example/*'],
      [subscription(['*://*.sub.example/*', '*://*.shared.example/*'])]
    )
    expect(merged).toEqual(['*://*.manual.example/*', '*://*.shared.example/*', '*://*.sub.example/*'])
  })

  it('keeps manual rules applying when the subscription is removed', () => {
    expect(mergeWebSearchBlacklist(['*://*.manual.example/*'], [])).toEqual(['*://*.manual.example/*'])
  })
})

describe('toExcludedSiteDomains with merged rules', () => {
  it('maps whole-domain subscription rules to provider site exclusion', () => {
    const domains = toExcludedSiteDomains(
      mergeWebSearchBlacklist(['*://*.manual.example/*'], [
        { id: 'sub-1', url: 'https://lists.example/list.txt', rules: ['*://*.sub.example/*', '/regex/'] }
      ])
    )
    expect(domains).toEqual(['manual.example', 'sub.example'])
  })
})
