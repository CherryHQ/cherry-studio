import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import { classifyHtmlArtifactSource, remarkHtmlArtifact } from '../remarkHtmlArtifact'

function parse(source: string, withLatexMath = false): Root {
  const processor = withLatexMath
    ? unified().use(remarkParse).use(remarkLatexMath).use(remarkHtmlArtifact)
    : unified().use(remarkParse).use(remarkHtmlArtifact)
  return processor.runSync(processor.parse(source), { value: source })
}

describe('remarkHtmlArtifact', () => {
  it('keeps native disclosure boundaries around Markdown instead of creating empty previews', () => {
    const tree = parse(String.raw`Before

<details>
<summary>Answer (click to expand)</summary>

$$
y = \frac{1}{2x} - \frac{1}{2x^3}
$$

**Quick check:** This content should be hidden while the disclosure is closed.
</details>

After`)

    expect(tree.children.some((child) => child.type === 'code')).toBe(false)
    expect(tree.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'html', value: '<details>\n<summary>Answer (click to expand)</summary>' }),
        expect.objectContaining({ type: 'html', value: '</details>' })
      ])
    )
  })

  it('keeps nested disclosures and their raw HTML content on the native Markdown path', () => {
    const tree = parse(`<details title="</details>">
<summary>Outer</summary>

<!-- </details> is only a comment -->

<details>
<summary>Inner</summary>

<div>Hidden content</div>

</details>

</details>

<div>Independent preview</div>`)

    expect(tree.children.filter((child) => child.type === 'code')).toEqual([
      expect.objectContaining({ lang: 'html', value: '<div>Independent preview</div>' })
    ])
  })

  it.each([
    '<details><summary>Answer</summary>Content</details>',
    '<!-- note --><DETAILS open><SUMMARY>Answer</SUMMARY>Content</DETAILS>',
    '<summary>Answer</summary>'
  ])('keeps compact native disclosure HTML: %s', (source) => {
    expect(parse(source).children).toEqual([expect.objectContaining({ type: 'html', value: source })])
  })

  it('still previews an independent HTML fragment that contains a disclosure', () => {
    const source = '<div><details><summary>Preview</summary>Content</details></div>'
    expect(parse(source).children).toEqual([expect.objectContaining({ type: 'code', lang: 'html', value: source })])
  })

  it('converts top-level raw HTML regions into HTML code nodes', () => {
    const tree = parse(`## Before

<div><strong>First preview</strong></div>

### Between

<div class="card">Second preview</div>

### After`)

    expect(tree.children.map((child) => child.type)).toEqual(['heading', 'code', 'heading', 'code', 'heading'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div><strong>First preview</strong></div>'
    })
    expect(tree.children[3]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div class="card">Second preview</div>'
    })
  })

  it('converts an incomplete top-level HTML block while streaming', () => {
    const tree = parse('<div><span>Still generating')

    expect(tree.children[0]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div><span>Still generating'
    })
  })

  it('keeps a complete HTML document with blank lines in one code node', () => {
    const source = `<!doctype html>
<html>
<head>
  <title>Demo</title>

  <style>body { color: red; }</style>
</head>

<body>
  <h1>Hello</h1>
</body>
</html>`
    const tree = parse(source)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('keeps Markdown-shaped text inside a complete HTML document', () => {
    const source = `<!doctype html>
<html><body>

Hello

</body></html>`
    const tree = parse(source)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('keeps LaTeX delimiters inside HTML artifacts as source text', () => {
    const source = '<div>\\(html\\)</div>'
    const tree = parse(source, true)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('leaves an incomplete HTML document on the Markdown path', () => {
    const tree = parse(`<html><body>

Still generating`)

    expect(tree.children.some((child) => child.type === 'code')).toBe(false)
    expect(tree.children[0]).toMatchObject({ type: 'html', value: '<html><body>' })
  })

  it('leaves inline HTML inside Markdown paragraphs unchanged', () => {
    const tree = parse('Text with <span>inline HTML</span>.')

    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text' }, { type: 'html' }, { type: 'text' }, { type: 'html' }, { type: 'text' }]
    })
  })

  it('does not create a preview for comments or a standalone doctype', () => {
    const tree = parse('<!-- internal note -->\n\n<!doctype html>')

    expect(tree.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'html', value: '<!-- internal note -->' })])
    )
    expect(tree.children.every((child) => child.type === 'html')).toBe(true)
  })

  it('keeps SVG in the dedicated Markdown SVG renderer path', () => {
    const tree = parse('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" /></svg>')

    expect(tree.children).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'code' })]))
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'html', value: expect.stringContaining('<svg') })
      ])
    })
  })

  describe('classifyHtmlArtifactSource', () => {
    it.each([
      ['<div>Fragment</div>', 'fragment'],
      ['<section class="a b">Fragment</section>', 'fragment'],
      ['<!-- note --><section>Fragment</section>', 'fragment'],
      ['<html><body>Document</body></html>', 'document'],
      ['<html lang="en"><body>Document</body></html>', 'document'],
      ['<!doctype html><html><body>Document</body></html>', 'document'],
      ['<!-- note --><!DOCTYPE html><html><body>Document</body></html>', 'document']
    ])('classifies complete HTML source: %s', (source, expected) => {
      expect(classifyHtmlArtifactSource(source)).toBe(expected)
    })

    it.each([
      ['', 'empty fence'],
      ['<', 'bare angle bracket'],
      ['<!doc', 'partial doctype'],
      ['<htm', 'partial html tag'],
      ['<di', 'partial fragment tag'],
      ['<div class="unfinished', 'unterminated attribute list']
    ])('withholds a verdict while the source is unclassifiable (%s)', (source) => {
      expect(classifyHtmlArtifactSource(source)).toBeUndefined()
    })

    it('never flips its verdict once a streamed document becomes classifiable', () => {
      const full = '<!doctype html>\n<html>\n<body><h1>Hi</h1></body>\n</html>'
      const verdicts = Array.from({ length: full.length }, (_, index) =>
        classifyHtmlArtifactSource(full.slice(0, index + 1))
      ).filter((verdict) => verdict !== undefined)

      expect(verdicts.length).toBeGreaterThan(0)
      expect(new Set(verdicts)).toEqual(new Set(['document']))
    })

    it('never flips its verdict once a streamed fragment becomes classifiable', () => {
      const full = '<div class="card"><h1>Hi</h1></div>'
      const verdicts = Array.from({ length: full.length }, (_, index) =>
        classifyHtmlArtifactSource(full.slice(0, index + 1))
      ).filter((verdict) => verdict !== undefined)

      expect(verdicts.length).toBeGreaterThan(0)
      expect(new Set(verdicts)).toEqual(new Set(['fragment']))
    })
  })
})
