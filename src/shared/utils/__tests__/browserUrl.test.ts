import { describe, expect, it } from 'vitest'

import { normalizeBrowserEntryUrl, normalizeBrowserUrl } from '../browserUrl'

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
