import { describe, expect, it } from 'vitest'

import { parseKnowledgeUrls } from '../parseKnowledgeUrls'

describe('parseKnowledgeUrls', () => {
  it('splits physical lines and mixed separators without counting empty tokens', () => {
    expect(parseKnowledgeUrls(' , \r\nhttps://a.test, bad\t https://b.test\r\rhttps://c.test\n, nope , ')).toEqual({
      valid: [
        { value: 'https://a.test', line: 2, index: 1 },
        { value: 'https://b.test', line: 2, index: 3 },
        { value: 'https://c.test', line: 4, index: 4 }
      ],
      invalid: [
        { value: 'bad', line: 2, index: 2 },
        { value: 'nope', line: 5, index: 5 }
      ]
    })
  })

  it.each(['', ' ,\r\n,\r \n\t,, '])('ignores empty input and separators: %j', (raw) => {
    expect(parseKnowledgeUrls(raw)).toEqual({ valid: [], invalid: [] })
  })

  it('returns all ten distinct URLs in input order', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`)
    expect(parseKnowledgeUrls(urls.join('\n'))).toEqual({
      valid: urls.map((value, i) => ({ value, line: i + 1, index: i + 1 })),
      invalid: []
    })
  })

  it.each([0, 4, 9])('keeps nine valid URLs when invalid entry is at position %i', (position) => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}`)
    const tokens = [...urls]
    tokens.splice(position, 0, 'not-a-url')
    const result = parseKnowledgeUrls(tokens.join('\n'))
    expect(result.valid.map(({ value }) => value)).toEqual(urls)
    expect(result.invalid).toEqual([{ value: 'not-a-url', line: position + 1, index: position + 1 }])
  })

  it('rejects bare domains, relative paths, and non-HTTP protocols with their locations', () => {
    const tokens = ['example.com', '/relative', 'ftp://example.com', 'file:///etc/passwd', 'not-a-url']
    expect(parseKnowledgeUrls(tokens.join(' '))).toEqual({
      valid: [],
      invalid: tokens.map((value, i) => ({ value, line: 1, index: i + 1 }))
    })
  })

  it('accepts query, hash, ports, and localhost and preserves case, slashes, and percent encoding', () => {
    const urls = [
      'HTTPS://EXAMPLE.COM/A?X=Y#Z',
      'https://example.com',
      'https://example.com/',
      'http://localhost:8080/path?q=a%20b#section',
      'https://example.com/a%20b?q=a%2Cb'
    ]
    expect(parseKnowledgeUrls(`  ${urls.join('\t')}  `)).toEqual({
      valid: urls.map((value, i) => ({ value, line: 1, index: i + 1 })),
      invalid: []
    })
  })

  it('splits literal commas and whitespace but leaves encoded commas intact', () => {
    expect(parseKnowledgeUrls('https://example.com/a,b https://example.com/a%2Cb')).toEqual({
      valid: [
        { value: 'https://example.com/a', line: 1, index: 1 },
        { value: 'https://example.com/a%2Cb', line: 1, index: 3 }
      ],
      invalid: [{ value: 'b', line: 1, index: 2 }]
    })
  })

  it('preserves duplicate URL entries', () => {
    expect(parseKnowledgeUrls('https://example.com,https://example.com').valid).toEqual([
      { value: 'https://example.com', line: 1, index: 1 },
      { value: 'https://example.com', line: 1, index: 2 }
    ])
  })
})
