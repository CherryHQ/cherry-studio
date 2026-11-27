import { describe, expect, it } from 'vitest'

import { normalizeBrowserEntryUrl, normalizeBrowserUrl, sanitizeBrowserVisitUrl } from '../browserUrl'

describe('browser entry URLs', () => {
  it.each(['file:///tmp/local%20page.html', 'file:///C:/Projects/index.htm', 'file:///tmp/index.HTML#section'])(
    'accepts explicit local HTML: %s',
    (url) => {
      expect(normalizeBrowserEntryUrl(url)).toBe(url)
      expect(() => normalizeBrowserUrl(url)).toThrow()
    }
  )
  it.each([
    'file://server/share/index.html',
    'file:////server/index.html',
    'file:///tmp/data.json',
    'javascript:alert(1)',
    'https://user:pass@example.com'
  ])('rejects unsupported entries: %s', (url) => {
    expect(() => normalizeBrowserEntryUrl(url)).toThrow()
  })
  it.each(['http://localhost:3000/', 'http://192.168.1.1/', 'https://example.com/'])(
    'preserves network browsing: %s',
    (url) => {
      expect(normalizeBrowserEntryUrl(url)).toBe(url)
    }
  )
})

describe('browser visit URL sanitization', () => {
  it('strips userinfo and sensitive query parameters while preserving ordinary parameters', () => {
    expect(
      sanitizeBrowserVisitUrl(
        'https://alice:secret@example.test/callback?token=secret&access_token=secret&code=secret&signature=secret&q=1'
      )
    ).toBe('https://example.test/callback?q=1')
  })

  it.each([
    ['#access_token=fragment-secret', ''],
    ['#/reports?api_key=secret', '#/reports'],
    ['#section-2', '#section-2']
  ])('removes fragment parameters while preserving navigation: %s', (fragment, expected) => {
    expect(sanitizeBrowserVisitUrl(`https://example.test/${fragment}`)).toBe(`https://example.test/${expected}`)
  })

  it.each(['about:blank', 'file:///tmp/index.html', 'invalid'])(
    'excludes unsupported or malformed destinations from storage: %s',
    (url) => {
      expect(sanitizeBrowserVisitUrl(url)).toBeUndefined()
    }
  )

  it('excludes a sanitized href longer than 16 KiB', () => {
    expect(sanitizeBrowserVisitUrl(`https://example.test/${'a'.repeat(16_384)}`)).toBeUndefined()
  })

  it('preserves ordinary browsing URLs', () => {
    expect(sanitizeBrowserVisitUrl('https://example.test/path?q=1#section-2')).toBe(
      'https://example.test/path?q=1#section-2'
    )
  })
})
