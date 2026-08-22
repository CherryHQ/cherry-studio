import type { InlineCode, Link, Paragraph, PhrasingContent, Root, Text } from 'mdast'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { remarkLiteralAutolinkFix } from '../remarkLiteralAutolinkFix'

function text(value: string): Text {
  return { type: 'text', value }
}

function swallowedLink(url: string, label?: string): Link {
  return { type: 'link', url, children: [text(label ?? url)] }
}

function run(source: string, children: PhrasingContent[]): PhrasingContent[] {
  const processor = unified().use(remarkLiteralAutolinkFix)
  const paragraph: Paragraph = { type: 'paragraph', children }
  const tree: Root = { type: 'root', children: [paragraph] }
  const result = processor.runSync(tree, { value: source })
  const first = result.children[0]
  return first?.type === 'paragraph' ? first.children : []
}

describe('remarkLiteralAutolinkFix', () => {
  it('re-pairs emphasis that GitHub/cmark-gfm would leave inside the href (deliberate deviation)', () => {
    const badUrl = 'https://github.com/CherryHQ/cherry-studio/pull/19113**（`tommyzhang100504:fix`'
    const children = run('PR 已创建：**https://…**（`x`）', [
      text('PR 已创建：**'),
      swallowedLink(badUrl),
      text(' → main）。')
    ])

    expect(children).toEqual([
      text('PR 已创建：'),
      {
        type: 'strong',
        children: [
          {
            type: 'link',
            url: 'https://github.com/CherryHQ/cherry-studio/pull/19113',
            children: [text('https://github.com/CherryHQ/cherry-studio/pull/19113')]
          }
        ]
      },
      text('（'),
      { type: 'inlineCode', value: 'tommyzhang100504:fix' } satisfies InlineCode,
      text(' → main）。')
    ])
  })

  it('cuts at the closing markers, preserving earlier marker runs inside the path', () => {
    const children = run('**https://x.com/a/**/b**(x)', [text('**'), swallowedLink('https://x.com/a/**/b**(x)')])

    expect(children).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'https://x.com/a/**/b', children: [text('https://x.com/a/**/b')] }]
      },
      text('(x)')
    ])
  })

  it('repairs unpunctuated tails starting with letters or CJK ideographs', () => {
    for (const tail of ['Notes', '中文']) {
      const children = run(`**https://a.com/x**${tail}`, [text('**'), swallowedLink(`https://a.com/x**${tail}`)])

      expect(children).toEqual([
        {
          type: 'strong',
          children: [{ type: 'link', url: 'https://a.com/x', children: [text('https://a.com/x')] }]
        },
        text(tail)
      ])
    }
  })

  it('mirrors the cut onto a www literal whose url carries the http:// prefix', () => {
    const children = run('**www.a.com/b**。', [text('**'), swallowedLink('http://www.a.com/b**。', 'www.a.com/b**。')])

    expect(children).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'http://www.a.com/b', children: [text('www.a.com/b')] }]
      },
      text('。')
    ])
  })

  it('never wraps the slice when a tiny www label is cut shorter than the scheme delta', () => {
    const children = run('**a**b', [text('**'), swallowedLink('http://a**b', 'a**b')])

    expect(children).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'http://a', children: [text('a')] }]
      },
      text('b')
    ])
  })

  it('keeps spec behavior when no emphasis opener hugs the link', () => {
    for (const lead of ['see ', '**<', '']) {
      const input: PhrasingContent[] =
        lead === '**<' ? [swallowedLink('https://a.com/x**b')] : [text(lead), swallowedLink('https://a.com/x**(y)')]
      expect(run(`${lead}https://a.com/x**(y)`, input)).toEqual(input)
    }
  })

  it('leaves clean links untouched', () => {
    const input: PhrasingContent[] = [text('see **'), swallowedLink('https://a.com/x'), text(' now')]
    expect(run('see **https://a.com/x** now', input)).toEqual(input)
  })

  it('leaves single-star links untouched', () => {
    const input: PhrasingContent[] = [text('*'), swallowedLink('https://a.com/x*(y)')]
    expect(run('*https://a.com/x*(y)', input)).toEqual(input)
  })

  it('leaves explicit `[label](url)` links untouched even with stars in the url', () => {
    const input: PhrasingContent[] = [text('**'), swallowedLink('https://a.com/x**(y)', 'label')]
    expect(run('[label](https://a.com/x**(y))', input)).toEqual(input)
  })

  it('keeps spec behavior when the closing markers continue into a port or query', () => {
    const input: PhrasingContent[] = [text('**'), swallowedLink('https://a.com/x**:8080')]
    expect(run('**https://a.com/x**:8080', input)).toEqual(input)
  })

  it('is idempotent across streaming frames', () => {
    const source = '**https://a.com/x**（note）'
    const first = run(source, [text('**'), swallowedLink('https://a.com/x**（note）')])
    const second = run(source, structuredClone(first))

    expect(second).toEqual(first)
  })
})
