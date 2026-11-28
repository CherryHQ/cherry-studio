import { describe, expect, it } from 'vitest'

import { collectKnowledgeUrlLinks } from '../urlLinks'

describe('bounded same-origin URL crawl discovery', () => {
  it('resolves relative Markdown, reference and GFM autolinks and strips fragments', () => {
    expect(
      collectKnowledgeUrlLinks(
        '[A](../guide#one) [ref][doc] <https://example.com/raw>\n\n[doc]: /reference',
        'https://example.com/docs/start'
      )
    ).toEqual(['https://example.com/guide', 'https://example.com/reference', 'https://example.com/raw'])
  })
  it('ignores code, images, fragments, cross-origin URLs, other protocols, credentials and duplicates', () => {
    const markdown =
      '[self](#section) [root](/docs/start#x) [external](https://other.example/a) [port](https://example.com:444/a) [mail](mailto:a@example.com) [js](javascript:alert) [auth](https://a:b@example.com/private) ![image](/image.png) `[/code](/code)` [ok](/good#one) [dup](https://example.com:443/good#two)'
    expect(collectKnowledgeUrlLinks(markdown, 'https://example.com/docs/start')).toEqual(['https://example.com/good'])
  })
  it('stops after 19 unique child URLs, without following grandchildren', () => {
    const links = Array.from({ length: 50 }, (_, index) => `[${index}](/${index})`).join(' ')
    expect(collectKnowledgeUrlLinks(links, 'https://example.com')).toEqual(
      Array.from({ length: 19 }, (_, index) => `https://example.com/${index}`)
    )
  })
  it('handles cyclic self references and preserves query identity', () => {
    expect(
      collectKnowledgeUrlLinks('[a](?q=a) [b](?q=b) [self](./start) [a2](?q=a#x)', 'https://example.com/docs/start')
    ).toEqual(['https://example.com/docs/start?q=a', 'https://example.com/docs/start?q=b'])
  })
  it('uses the first Markdown definition and ignores unused definitions', () => {
    expect(
      collectKnowledgeUrlLinks('[a][ref]\n\n[ref]: /first\n[ref]: /second\n[unused]: /unused', 'https://example.com')
    ).toEqual(['https://example.com/first'])
  })
  it('does not collect non-HTTP root URLs', () => {
    expect(collectKnowledgeUrlLinks('[a](ftp://example.com/a)', 'ftp://example.com')).toEqual([])
  })
})
