import { describe, expect, it } from 'vitest'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { mergeProviderEndpoints } from '../tools/config'
import { sliceContent } from '../tools/content'
import { filterResultsByUrlRules } from '../tools/urlFilter'

describe('optional host-composed utilities', () => {
  it('keeps explicit empty endpoint overrides and does not mutate shared metadata', () => {
    const result = mergeProviderEndpoints(WEB_SEARCH_PROVIDER_CATALOG.jina, { fetchUrls: { apiHost: '' } })
    expect(result.capabilities.find((item) => item.capability === 'fetchUrls')?.defaultApiHost).toBe('')
    expect(
      WEB_SEARCH_PROVIDER_CATALOG.jina.capabilities.find((item) => item.capability === 'fetchUrls')?.defaultApiHost
    ).toBe('https://r.jina.ai')
  })

  it('enforces character and zero-token limits without emitting half a surrogate pair', () => {
    expect(sliceContent('hello world', { maxTokens: 0 })).toEqual({ content: '', truncated: true })
    expect(sliceContent('a😀b', { maxTokens: 100, maxCharacters: 2 })).toEqual({ content: 'a', truncated: true })
    expect(sliceContent('hello', { maxTokens: 100, maxCharacters: 100 })).toEqual({
      content: 'hello',
      truncated: false
    })
  })

  it('filters URL patterns and regexes while returning malformed-rule diagnostics', () => {
    const results = [
      { url: 'https://docs.example.com/private/page' },
      { url: 'https://allowed.example/page' },
      { url: 'invalid' }
    ]
    const result = filterResultsByUrlRules(results, ['https://*.example.com/private/*', '/[broken/'])
    expect(result.results).toEqual([{ url: 'https://allowed.example/page' }, { url: 'invalid' }])
    expect(result.diagnostics.map((item) => item.kind)).toEqual(['regex', 'url'])
    expect(results).toHaveLength(3)
  })
})
