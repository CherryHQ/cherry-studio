import type { Link, PhrasingContent, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { remarkLiteralAutolinkFix } from '../remarkLiteralAutolinkFix'

// Parse and transform on one processor: GFM's syntax extensions only act during tokenize,
// so a tree parsed without them would not contain the literal autolinks at all.
const parse = (source: string): Root => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkLiteralAutolinkFix)
  // The unified generic resolves differently across toolchains; narrow via unknown explicitly.
  const tree: unknown = processor.runSync(processor.parse(source), { value: source })
  return tree as Root
}

const parseWithoutPlugin = (source: string): Root => {
  const processor = unified().use(remarkParse).use(remarkGfm)
  const tree: unknown = processor.runSync(processor.parse(source), { value: source })
  return tree as Root
}

function inlineChildren(source: string): PhrasingContent[] {
  const first = parse(source).children[0]
  if (first?.type !== 'paragraph') throw new Error(`expected a paragraph, got ${first?.type}`)
  return first.children
}

// Position-free projection so assertions compare structure, not source spans.
type Shape = { type: string; value?: string; url?: string; children?: Shape[] }
function shape(node: PhrasingContent): Shape {
  const out: Shape = { type: node.type }
  if ('value' in node) out.value = node.value
  if (node.type === 'link') out.url = node.url
  if ('children' in node) out.children = node.children.map(shape)
  return out
}

describe('remarkLiteralAutolinkFix', () => {
  it('re-pairs emphasis that GitHub/cmark-gfm would leave inside the href (deliberate deviation)', () => {
    expect(
      inlineChildren('PR 已创建：**https://github.com/CherryHQ/cherry-studio/pull/19113**（`x` → `y`）。').map(shape)
    ).toEqual([
      { type: 'text', value: 'PR 已创建：' },
      {
        type: 'strong',
        children: [
          {
            type: 'link',
            url: 'https://github.com/CherryHQ/cherry-studio/pull/19113',
            children: [{ type: 'text', value: 'https://github.com/CherryHQ/cherry-studio/pull/19113' }]
          }
        ]
      },
      { type: 'text', value: '（' },
      { type: 'inlineCode', value: 'x' },
      { type: 'text', value: ' → ' },
      { type: 'inlineCode', value: 'y' },
      { type: 'text', value: '）。' }
    ])
  })

  it('leaves angle-bracket autolinks untouched — the stars there are intentional', () => {
    const source = '**<https://a.com/x**(y)>'
    expect(inlineChildren(source)).toEqual(
      (() => {
        const first = parseWithoutPlugin(source).children[0]
        if (first?.type !== 'paragraph') throw new Error('expected a paragraph')
        return first.children
      })()
    )
  })

  it('leaves explicit `[label](url)` links untouched even when label equals url', () => {
    const source = '**[https://a.com/x**(y)](https://a.com/x**(y))'
    const expected = parseWithoutPlugin(source)
    expect(parse(source)).toEqual(expected)
  })

  it('cuts at the closing marker run, preserving earlier marker runs inside the path', () => {
    expect(inlineChildren('**https://x.com/a/**/b**(x)').map(shape)).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'link', url: 'https://x.com/a/**/b', children: [{ type: 'text', value: 'https://x.com/a/**/b' }] }
        ]
      },
      { type: 'text', value: '(x)' }
    ])
  })

  it('consumes longer marker runs on both sides without leaving stray stars', () => {
    for (const source of ['***https://a.com/x***(y)', '**https://a.com/x****(y)']) {
      expect(inlineChildren(source).map(shape)).toEqual([
        {
          type: 'strong',
          children: [{ type: 'link', url: 'https://a.com/x', children: [{ type: 'text', value: 'https://a.com/x' }] }]
        },
        { type: 'text', value: '(y)' }
      ])
    }
  })

  it('repairs unpunctuated tails starting with letters or CJK ideographs', () => {
    for (const tail of ['Notes', '中文']) {
      expect(inlineChildren(`**https://a.com/x**${tail}`).map(shape)).toEqual([
        {
          type: 'strong',
          children: [{ type: 'link', url: 'https://a.com/x', children: [{ type: 'text', value: 'https://a.com/x' }] }]
        },
        { type: 'text', value: tail }
      ])
    }
  })

  it('mirrors the cut onto a www literal whose url carries the http:// prefix', () => {
    expect(inlineChildren('**www.a.com/b**。').map(shape)).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'http://www.a.com/b', children: [{ type: 'text', value: 'www.a.com/b' }] }]
      },
      { type: 'text', value: '。' }
    ])
  })

  it('keeps escaped stars intact — a rendering opener must be real emphasis, not `\\**`', () => {
    const source = '\\*\\*https://a.com/x**(y)'
    expect(parse(source)).toEqual(parseWithoutPlugin(source))
  })

  it('keeps spec behavior when no emphasis opener hugs the link', () => {
    const source = 'see https://x.com/a/**/b**(x)'
    expect(parse(source)).toEqual(parseWithoutPlugin(source))
  })

  it('keeps spec behavior when the closing markers continue into a port, query, or path extension', () => {
    for (const source of [
      '**https://a.com/x**:8080',
      '**https://a.com/x**?q=1',
      '**https://a.com/x**.html',
      '**https://a.com/x**-suffix',
      '**https://a.com/x**_v2'
    ]) {
      expect(parse(source)).toEqual(parseWithoutPlugin(source))
    }
  })

  it('keeps a second url inside the tail clickable (tail parses with GFM like the document)', () => {
    const tree = parse('**https://a.com/x**https://b.com')
    const paragraph = tree.children[0]
    if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(shape(paragraph.children[1])).toEqual({
      type: 'link',
      url: 'https://b.com',
      children: [{ type: 'text', value: 'https://b.com' }]
    })
  })

  it('repairs inside nested contexts like blockquotes', () => {
    const tree = parse('> **https://a.com/x**(y)')
    const blockquote = tree.children[0]
    if (blockquote?.type !== 'blockquote') throw new Error('expected a blockquote')
    const paragraph = blockquote.children[0]
    if (paragraph.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(paragraph.children.map(shape)).toEqual([
      {
        type: 'strong',
        children: [{ type: 'link', url: 'https://a.com/x', children: [{ type: 'text', value: 'https://a.com/x' }] }]
      },
      { type: 'text', value: '(y)' }
    ])
  })

  it('fails closed on nodes without position data instead of guessing their origin', () => {
    const link: Link = {
      type: 'link',
      url: 'https://a.com/x**(y)',
      children: [{ type: 'text', value: 'https://a.com/x**(y)' }]
    }
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: '**' }, link] }]
    }
    const processor = unified().use(remarkLiteralAutolinkFix)
    expect(processor.runSync(structuredClone(tree), { value: '**https://a.com/x**(y)' })).toEqual(tree)
  })

  it('is idempotent: an already-repaired tree passes through unchanged', () => {
    const once = parse('**https://a.com/x**（note）')
    const processor = unified().use(remarkLiteralAutolinkFix)
    expect(processor.runSync(structuredClone(once), { value: '**https://a.com/x**（note）' })).toEqual(once)
  })
})
