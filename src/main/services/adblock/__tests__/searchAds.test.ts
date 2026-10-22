import { describe, expect, it } from 'vitest'

import { getSearchAdsCss, isSearchResultPage } from '../searchAds'

describe('search-result ad styles', () => {
  it('returns promoted-slot rules for Baidu, desktop and mobile', () => {
    for (const url of ['https://www.baidu.com/s?wd=test', 'https://m.baidu.com/s?word=test']) {
      const css = getSearchAdsCss(url)
      expect(css, url).toContain('[data-tuiguang]')
      expect(css, url).toContain('display: none')
    }
  })

  it('covers the Google, Bing, Sogou and 360 result pages', () => {
    expect(getSearchAdsCss('https://www.google.com/search?q=test')).toContain('#tads')
    expect(getSearchAdsCss('https://www.google.com.hk/search?q=test')).toContain('#tads')
    expect(getSearchAdsCss('https://cn.bing.com/search?q=test')).toContain('.b_adLastChild')
    expect(getSearchAdsCss('https://www.sogou.com/web?query=test')).toContain('#right .pt')
    expect(getSearchAdsCss('https://www.so.com/s?q=test')).toContain('.res-list[data-tuiguang]')
  })

  it('does not touch ordinary pages or non-web schemes', () => {
    for (const url of [
      'https://example.com/',
      'https://mail.google.com/mail/u/0/',
      'about:blank',
      'file:///tmp/page.html',
      'cherry-miniapp://com.example.app/index.html',
      'not a url'
    ]) {
      expect(getSearchAdsCss(url), url).toBeUndefined()
      expect(isSearchResultPage(url), url).toBe(false)
    }
  })

  it('matches subdomains without matching lookalike hosts', () => {
    expect(isSearchResultPage('https://www.baidu.com/s?wd=test')).toBe(true)
    expect(isSearchResultPage('https://baidu.com/s?wd=test')).toBe(true)
    expect(isSearchResultPage('https://notbaidu.com/s?wd=test')).toBe(false)
    expect(isSearchResultPage('https://baidu.com.evil.test/s?wd=test')).toBe(false)
  })

  it('leaves non-search pages of the same engine alone', () => {
    expect(isSearchResultPage('https://mail.google.com/mail/u/0/')).toBe(false)
    expect(isSearchResultPage('https://tieba.baidu.com/p/123456')).toBe(false)
    expect(isSearchResultPage('https://www.google.com/')).toBe(false)
    expect(isSearchResultPage('https://www.bing.com/images/search?q=test')).toBe(false)
  })
})
