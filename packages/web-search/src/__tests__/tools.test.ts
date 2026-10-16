import { expect, it } from 'vitest'

import { mergeApiEndpoint, resolveApiHost } from '../tools/config'
import { sliceContent } from '../tools/content'
import { filterByUrlRules } from '../tools/urlFilter'

it('filters match patterns and regexes in order while retaining malformed URLs', () => {
  const urls = [
    'https://example.com/x?q=1#fragment',
    'http://sub.example.com/x',
    'https://other.test/blocked?q=2',
    'https://other.test/keep',
    'broken',
    'ftp://example.com/x'
  ].map((url) => ({ url }))
  expect(
    filterByUrlRules(urls, [' *://*.example.com/* ', '/BLOCKED\\?q=2/', '/[/', 'example.com', 'ftp://*/*'])
  ).toEqual([{ url: 'https://other.test/keep' }, { url: 'broken' }, { url: 'ftp://example.com/x' }])
  expect(filterByUrlRules(urls, ['<all_urls>'])).toEqual([{ url: 'broken' }, { url: 'ftp://example.com/x' }])
  expect(filterByUrlRules(urls, ['https://example.com/x?q=*'])).toEqual(urls.slice(1))
})
it('matches wildcard paths, schemes and exact hosts without consuming fragments', () => {
  const results = [
    'https://x.test/a/b/c?x=1#f',
    'https://x.test/a/b/d',
    'http://x.test/a/b/c?x=1',
    'https://sub.x.test/a/b/c?x=1'
  ].map((url) => ({ url }))
  expect(filterByUrlRules(results, ['https://x.test/a/*/c?x=*'])).toEqual(results.slice(1))
  expect(filterByUrlRules(results, ['/\\#f/'])).toEqual(results)
})
it('resolves only absent hosts to defaults and validates schemes', () => {
  expect(resolveApiHost(undefined, 'https://default.test')).toBe('https://default.test')
  for (const value of ['', '   '])
    expect(() => resolveApiHost(value, 'https://default.test')).toThrow(
      expect.objectContaining({ code: 'api_host_missing' })
    )
  for (const value of ['ftp://x.test', 'invalid'])
    expect(() => resolveApiHost(value)).toThrow(expect.objectContaining({ code: 'api_host_invalid' }))
})
it('merges paths without rewriting encoded path parameters or raw Reader URLs', () => {
  expect(mergeApiEndpoint('https://api.test/base/', '/v1/search/q=a%2Fb%20c&num=2')).toBe(
    'https://api.test/base/v1/search/q=a%2Fb%20c&num=2'
  )
  expect(mergeApiEndpoint('https://r.jina.ai/', 'https://target.test/a%2Fb?q=x%20y&n=2')).toBe(
    'https://r.jina.ai/https://target.test/a%2Fb?q=x%20y&n=2'
  )
})
it('slices characters before tokens with no default budget or ellipsis', () => {
  expect(sliceContent('hello world', {})).toEqual({ content: 'hello world', truncated: false })
  expect(sliceContent('hello world', { maxCharacters: 0 })).toEqual({ content: '', truncated: true })
  expect(sliceContent('hello world', { maxTokens: 0 })).toEqual({ content: '', truncated: true })
  expect(sliceContent('hello world extra', { maxCharacters: 5, maxTokens: 10 })).toEqual({
    content: 'hello',
    truncated: true
  })
  expect(sliceContent('A😀B', { maxCharacters: 2 })).toEqual({ content: 'A', truncated: true })
  expect(sliceContent('', { maxCharacters: 0 })).toEqual({ content: '', truncated: false })
  expect(sliceContent('hello world', { maxTokens: 1 }).content).not.toContain('world')
})
it.each([-1, NaN, Infinity])('rejects invalid content limits %s', (limit) => {
  for (const limits of [{ maxCharacters: limit }, { maxTokens: limit }])
    expect(() => sliceContent('text', limits)).toThrow(
      expect.objectContaining({ kind: 'configuration', code: 'invalid_content_limit' })
    )
})
