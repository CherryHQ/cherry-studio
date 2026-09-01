import { describe, expect, it } from 'vitest'

import { createComposerLinkToken, parseComposerLink } from '../linkToken'

describe('parseComposerLink', () => {
  it('marks query/hash parts with an ellipsis instead of dropping them silently', () => {
    expect(parseComposerLink('https://example.com/docs?page=2')?.label).toBe('example.com/docs…')
    expect(parseComposerLink('https://example.com/docs#section')?.label).toBe('example.com/docs…')
    expect(parseComposerLink('https://example.com?a=1')?.label).toBe('example.com…')
    expect(parseComposerLink('https://example.com/docs?q=1#top')?.label).toBe('example.com/docs…')
  })

  it('keeps bare host+path labels free of the ellipsis', () => {
    expect(parseComposerLink('https://example.com')?.label).toBe('example.com')
    expect(parseComposerLink('https://example.com/docs')?.label).toBe('example.com/docs')
    expect(parseComposerLink('https://example.com/docs/')?.label).toBe('example.com/docs')
  })

  it('keeps the full url intact regardless of label truncation', () => {
    const url = 'https://example.com/docs?q=%E4%B8%AD%E6%96%87#top'
    const link = parseComposerLink(url)
    expect(link?.url).toBe(url)
    expect(link?.hostname).toBe('example.com')
  })

  it('rejects non-http(s) and unparsable values', () => {
    expect(parseComposerLink('ftp://example.com/file')).toBeNull()
    expect(parseComposerLink('not a url')).toBeNull()
    expect(parseComposerLink(undefined)).toBeNull()
  })
})

describe('createComposerLinkToken', () => {
  it('stores the truncated label while keeping the full url as promptText sent to the model', () => {
    const token = createComposerLinkToken('https://example.com/docs?page=2#top')
    expect(token?.kind).toBe('link')
    expect(token?.label).toBe('example.com/docs…')
    expect(token?.promptText).toBe('https://example.com/docs?page=2#top')
  })
})
