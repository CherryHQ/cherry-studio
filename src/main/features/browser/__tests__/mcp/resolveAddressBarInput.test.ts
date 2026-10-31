import { describe, expect, it } from 'vitest'

import { resolveAddressBarInput } from '../../mcp/resolveAddressBarInput'

describe('resolveAddressBarInput', () => {
  it.each([
    // #22029: free text must become a search term, never a mangled IDN host
    ['这不是一个网址 just some words', { kind: 'search', query: '这不是一个网址 just some words' }],
    ['hello world', { kind: 'search', query: 'hello world' }],
    ['hello', { kind: 'search', query: 'hello' }],
    ['example .com', { kind: 'search', query: 'example .com' }],
    // #22029: misspelled and non-web schemes must be rejected before loadURL
    ['htp://example.com', { kind: 'invalid' }],
    ['ftp://example.com', { kind: 'invalid' }],
    ['javascript:alert(1)', { kind: 'invalid' }],
    ['about:blank', { kind: 'invalid' }],
    // ordinary guests in this window cannot open local files
    ['file:///C:/page.html', { kind: 'invalid' }],
    // hosts: single tokens that parse as one, with the https default
    ['example.com', { kind: 'url', url: 'https://example.com/' }],
    ['example.com/path?q=1', { kind: 'url', url: 'https://example.com/path?q=1' }],
    ['EXAMPLE.com', { kind: 'url', url: 'https://example.com/' }],
    ['  example.com  ', { kind: 'url', url: 'https://example.com/' }],
    ['192.168.1.5:9000', { kind: 'url', url: 'https://192.168.1.5:9000/' }],
    ['3.14', { kind: 'url', url: 'https://3.0.0.14/' }], // WHATWG IPv4 parsing, same as Chromium
    // explicit schemes pass through validated
    ['https://example.com', { kind: 'url', url: 'https://example.com/' }],
    ['http://example.com:8080/x', { kind: 'url', url: 'http://example.com:8080/x' }],
    // local addresses default to http
    ['localhost', { kind: 'url', url: 'http://localhost/' }],
    ['localhost:3000/admin', { kind: 'url', url: 'http://localhost:3000/admin' }],
    ['127.0.0.1:8080', { kind: 'url', url: 'http://127.0.0.1:8080/' }],
    ['[::1]:5173', { kind: 'url', url: 'http://[::1]:5173/' }],
    // empty input
    ['', { kind: 'invalid' }],
    ['   ', { kind: 'invalid' }]
  ])('resolves %s', (input, expected) => {
    expect(resolveAddressBarInput(input)).toEqual(expected)
  })

  it('treats an IDN domain as a host URL', () => {
    const resolution = resolveAddressBarInput('百度.com')
    expect(resolution.kind).toBe('url')
    expect(resolution.kind === 'url' && resolution.url.startsWith('https://xn--')).toBe(true)
  })
})
