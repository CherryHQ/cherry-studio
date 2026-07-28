/*
 * MIT License
 *
 * Copyright (c) 2018 iorate
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * https://github.com/iorate/ublacklist
 */

import { describe, expect, it } from 'vitest'

import { mapRegexToPatterns, MatchPatternMap } from '../blacklistMatchPattern'

function get(map: MatchPatternMap<number>, url: string) {
  return map.get(url).sort()
}

describe('blacklistMatchPattern', () => {
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns
  it('MDN Examples', () => {
    const map = new MatchPatternMap<number>()
    map.set('<all_urls>', 0)
    map.set('*://*/*', 1)
    map.set('*://*.mozilla.org/*', 2)
    map.set('*://mozilla.org/', 3)
    expect(() => map.set('ftp://mozilla.org/', 4)).toThrow()
    map.set('https://*/path', 5)
    map.set('https://*/path/', 6)
    map.set('https://mozilla.org/*', 7)
    map.set('https://mozilla.org/a/b/c/', 8)
    map.set('https://mozilla.org/*/b/*/', 9)
    expect(() => map.set('file:///blah/*', 10)).toThrow()
    // <all_urls>
    expect(get(map, 'http://example.org/')).toEqual([0, 1])
    expect(get(map, 'https://a.org/some/path/')).toEqual([0, 1])
    expect(get(map, 'ws://sockets.somewhere.org/')).toEqual([])
    expect(get(map, 'wss://ws.example.com/stuff/')).toEqual([])
    expect(get(map, 'ftp://files.somewhere.org/')).toEqual([])
    expect(get(map, 'resource://a/b/c/')).toEqual([])
    expect(get(map, 'ftps://files.somewhere.org/')).toEqual([])
    // *://*/*
    expect(get(map, 'http://example.org/')).toEqual([0, 1])
    expect(get(map, 'https://a.org/some/path/')).toEqual([0, 1])
    expect(get(map, 'ws://sockets.somewhere.org/')).toEqual([])
    expect(get(map, 'wss://ws.example.com/stuff/')).toEqual([])
    expect(get(map, 'ftp://ftp.example.org/')).toEqual([])
    expect(get(map, 'file:///a/')).toEqual([])
    // *://*.mozilla.org/*
    expect(get(map, 'http://mozilla.org/')).toEqual([0, 1, 2, 3])
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'http://a.mozilla.org/')).toEqual([0, 1, 2])
    expect(get(map, 'http://a.b.mozilla.org/')).toEqual([0, 1, 2])
    expect(get(map, 'https://b.mozilla.org/path/')).toEqual([0, 1, 2, 6])
    expect(get(map, 'ws://ws.mozilla.org/')).toEqual([])
    expect(get(map, 'wss://secure.mozilla.org/something')).toEqual([])
    expect(get(map, 'ftp://mozilla.org/')).toEqual([])
    expect(get(map, 'http://mozilla.com/')).toEqual([0, 1])
    expect(get(map, 'http://firefox.org/')).toEqual([0, 1])
    // *://mozilla.org/
    expect(get(map, 'http://mozilla.org/')).toEqual([0, 1, 2, 3])
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'ws://mozilla.org/')).toEqual([])
    expect(get(map, 'wss://mozilla.org/')).toEqual([])
    expect(get(map, 'ftp://mozilla.org/')).toEqual([])
    expect(get(map, 'http://a.mozilla.org/')).toEqual([0, 1, 2])
    expect(get(map, 'http://mozilla.org/a')).toEqual([0, 1, 2])
    // ftp://mozilla.org/
    expect(get(map, 'ftp://mozilla.org/')).toEqual([])
    expect(get(map, 'http://mozilla.org/')).toEqual([0, 1, 2, 3])
    expect(get(map, 'ftp://sub.mozilla.org/')).toEqual([])
    expect(get(map, 'ftp://mozilla.org/path')).toEqual([])
    // https://*/path
    expect(get(map, 'https://mozilla.org/path')).toEqual([0, 1, 2, 5, 7])
    expect(get(map, 'https://a.mozilla.org/path')).toEqual([0, 1, 2, 5])
    expect(get(map, 'https://something.com/path')).toEqual([0, 1, 5])
    expect(get(map, 'http://mozilla.org/path')).toEqual([0, 1, 2])
    expect(get(map, 'https://mozilla.org/path/')).toEqual([0, 1, 2, 6, 7])
    expect(get(map, 'https://mozilla.org/a')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'https://mozilla.org/path?foo=1')).toEqual([0, 1, 2, 7])
    // https://*/path/
    expect(get(map, 'http://mozilla.org/path/')).toEqual([0, 1, 2])
    expect(get(map, 'https://a.mozilla.org/path/')).toEqual([0, 1, 2, 6])
    expect(get(map, 'https://something.com/path/')).toEqual([0, 1, 6])
    expect(get(map, 'http://mozilla.org/path/')).toEqual([0, 1, 2])
    expect(get(map, 'https://mozilla.org/path')).toEqual([0, 1, 2, 5, 7])
    expect(get(map, 'https://mozilla.org/a')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'https://mozilla.org/path?foo=1')).toEqual([0, 1, 2, 7])
    // https://mozilla.org/*
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'https://mozilla.org/path')).toEqual([0, 1, 2, 5, 7])
    expect(get(map, 'https://mozilla.org/another')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/path/to/doc')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/path/to/doc?foo=1')).toEqual([0, 1, 2, 7])
    // https://mozilla.org/a/b/c/
    expect(get(map, 'https://mozilla.org/a/b/c/')).toEqual([0, 1, 2, 7, 8, 9])
    expect(get(map, 'https://mozilla.org/a/b/c/#section1')).toEqual([0, 1, 2, 7, 8, 9])
    // https://mozilla.org/*/b/*/
    expect(get(map, 'https://mozilla.org/a/b/c/')).toEqual([0, 1, 2, 7, 8, 9])
    expect(get(map, 'https://mozilla.org/d/b/f/')).toEqual([0, 1, 2, 7, 9])
    expect(get(map, 'https://mozilla.org/a/b/c/d/')).toEqual([0, 1, 2, 7, 9])
    expect(get(map, 'https://mozilla.org/a/b/c/d/#section1')).toEqual([0, 1, 2, 7, 9])
    expect(get(map, 'https://mozilla.org/a/b/c/d/?foo=/')).toEqual([0, 1, 2, 7, 9])
    expect(get(map, 'https://mozilla.org/a?foo=21314&bar=/b/&extra=c/')).toEqual([0, 1, 2, 7, 9])
    expect(get(map, 'https://mozilla.org/b/*/')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/a/b/')).toEqual([0, 1, 2, 7])
    expect(get(map, 'https://mozilla.org/a/b/c/d/?foo=bar')).toEqual([0, 1, 2, 7])
    // file:///blah/*
    expect(get(map, 'file:///blah/')).toEqual([])
    expect(get(map, 'file:///blah/bleh')).toEqual([])
    expect(get(map, 'file:///bleh/')).toEqual([])
    // Invalid match patterns
    expect(() => map.set('resource://path/', 11)).toThrow()
    expect(() => map.set('https://mozilla.org', 12)).toThrow()
    expect(() => map.set('https://mozilla.*.org/', 13)).toThrow()
    expect(() => map.set('https://*zilla.org', 14)).toThrow()
    expect(() => map.set('http*://mozilla.org/', 15)).toThrow()
    expect(() => map.set('https://mozilla.org:80/', 16)).toThrow()
    expect(() => map.set('*//*', 17)).toThrow()
    expect(() => map.set('file://*', 18)).toThrow()
  })

  it('Serialization', () => {
    let map = new MatchPatternMap<number>()
    map.set('<all_urls>', 0)
    map.set('*://*/*', 1)
    map.set('*://*.mozilla.org/*', 2)
    map.set('*://mozilla.org/', 3)
    map.set('https://*/path', 5)
    map.set('https://*/path/', 6)
    map.set('https://mozilla.org/*', 7)
    map.set('https://mozilla.org/a/b/c/', 8)
    map.set('https://mozilla.org/*/b/*/', 9)
    const json = map.toJSON()
    expect(JSON.stringify(json)).toBe(
      '[[0],[[],[[1],[5,"https","/path"],[6,"https","/path/"]],{"org":[[],[],{"mozilla":[[[3,"*","/"],[7,"https"],[8,"https","/a/b/c/"],[9,"https","/*/b/*/"]],[[2]]]}]}]]'
    )
    map = new MatchPatternMap(json)
    expect(get(map, 'http://mozilla.org/')).toEqual([0, 1, 2, 3])
    expect(get(map, 'https://mozilla.org/')).toEqual([0, 1, 2, 3, 7])
    expect(get(map, 'http://a.mozilla.org/')).toEqual([0, 1, 2])
    expect(get(map, 'http://a.b.mozilla.org/')).toEqual([0, 1, 2])
    expect(get(map, 'https://b.mozilla.org/path/')).toEqual([0, 1, 2, 6])
  })
})

describe('mapRegexToPatterns', () => {
  it('extracts domains from regex patterns', () => {
    const result = mapRegexToPatterns([
      '/example\\.com/',
      '/(?:www\\.)?sub\\.example\\.co\\.uk/',
      '/api\\.service\\.io/',
      'https://baidu.com'
    ])

    expect(result).toEqual(['example.com', 'sub.example.co.uk', 'api.service.io', 'baidu.com'])
  })

  it('deduplicates domains across multiple patterns', () => {
    const result = mapRegexToPatterns(['/example\\.com/', '/(example\\.com|test\\.org)/'])

    expect(result).toEqual(['example.com', 'test.org'])
  })

  it('ignores patterns without domain matches', () => {
    const result = mapRegexToPatterns(['', 'plain-domain.com', '/^https?:\\/\\/[^/]+$/'])

    expect(result).toEqual(['plain-domain.com'])
  })
})
