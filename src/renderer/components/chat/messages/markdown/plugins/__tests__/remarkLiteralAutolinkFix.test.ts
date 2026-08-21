import type { InlineCode, Link, Paragraph, PhrasingContent, Root, Text } from 'mdast'
import { unified } from 'unified'
import type { Position } from 'unist'
import { describe, expect, it } from 'vitest'

import { remarkLiteralAutolinkFix } from '../remarkLiteralAutolinkFix'

function text(value: string): Text {
  return { type: 'text', value }
}

// Real remark-gfm output always carries a position; tests that must reach the fix set one.
function swallowedLink(url: string, options?: { label?: string; startOffset?: number }): Link {
  const node: Link = { type: 'link', url, children: [text(options?.label ?? url)] }
  const offset = options?.startOffset
  if (offset !== undefined) {
    const position: Position = {
      start: { line: 1, column: offset + 1, offset },
      end: { line: 1, column: offset + url.length + 1, offset: offset + url.length }
    }
    node.position = position
  }
  return node
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
      swallowedLink(badUrl, { startOffset: 9 }),
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

  it('drops an opener that hugs the link at the start of the line', () => {
    const children = run('**https://a.com/x**(see below)', [
      text('**'),
      swallowedLink('https://a.com/x**(see below)', { startOffset: 2 })
    ])

    expect(children).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'https://a.com/x', children: [text('https://a.com/x')] }]
      },
      text('(see below)')
    ])
  })

  it('mirrors the cut onto a www literal whose url carries the http:// prefix', () => {
    const children = run('**www.a.com/b**。', [
      text('**'),
      swallowedLink('http://www.a.com/b**', { label: 'www.a.com/b**', startOffset: 2 })
    ])

    expect(children).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'http://www.a.com/b', children: [text('www.a.com/b')] }]
      }
    ])
  })

  it('leaves clean links untouched', () => {
    const input: PhrasingContent[] = [
      text('see **'),
      swallowedLink('https://a.com/x', { startOffset: 7 }),
      text(' now')
    ]
    expect(run('see **https://a.com/x** now', input)).toEqual(input)
  })

  it('leaves single-star links untouched', () => {
    const input: PhrasingContent[] = [text('*'), swallowedLink('https://a.com/x*(y)', { startOffset: 1 })]
    expect(run('*https://a.com/x*(y)', input)).toEqual(input)
  })

  it('leaves angle-bracket autolinks untouched — their stars are intentional', () => {
    const input: PhrasingContent[] = [swallowedLink('https://a.com/x**b', { startOffset: 0 })]
    expect(run('<https://a.com/x**b>', input)).toEqual(input)
  })

  it('skips nodes without a position instead of guessing their origin', () => {
    const input: PhrasingContent[] = [text('**'), swallowedLink('https://a.com/x**(y)')]
    expect(run('**https://a.com/x**(y)', input)).toEqual(input)
  })

  it('leaves explicit `[label](url)` links untouched even with stars in the url', () => {
    const input: PhrasingContent[] = [swallowedLink('https://a.com/x**(y)', { label: 'label', startOffset: 1 })]
    expect(run('[label](https://a.com/x**(y))', input)).toEqual(input)
  })

  it('keeps spec behavior for glob-style urls where the stars continue into the path', () => {
    const input: PhrasingContent[] = [swallowedLink('https://x.com/a/**/b**(x)', { startOffset: 0 })]
    expect(run('https://x.com/a/**/b**(x)', input)).toEqual(input)
  })

  it('is idempotent across streaming frames', () => {
    const source = '**https://a.com/x**（note）'
    const first = run(source, [text('**'), swallowedLink('https://a.com/x**（note）', { startOffset: 2 })])
    const second = run(source, structuredClone(first))

    expect(second).toEqual(first)
  })
})
