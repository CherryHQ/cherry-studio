import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { remarkHtmlArtifact } from '../remarkHtmlArtifact'

function parse(source: string): Root {
  const processor = unified().use(remarkParse).use(remarkHtmlArtifact)
  return processor.runSync(processor.parse(source))
}

describe('remarkHtmlArtifact', () => {
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

    expect(tree.children[0]).toMatchObject({ type: 'html' })
  })
})
