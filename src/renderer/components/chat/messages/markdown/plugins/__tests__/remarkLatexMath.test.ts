import { render } from '@testing-library/react'
import type { InlineMath, Math, Nodes, Root } from 'mdast'
import { createElement } from 'react'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, expect, it, vi } from 'vitest'

import { defaultMarkdownPlugins, Markdown, withMath } from '@cherrystudio/ui'

import { remarkHtmlArtifact } from '../remarkHtmlArtifact'
import { remarkLatexMath } from '../remarkLatexMath'

vi.unmock('@cherrystudio/ui')

function parse(source: string, htmlArtifact = false): Root {
  const processor = unified().use(remarkParse).use(remarkLatexMath)
  if (htmlArtifact) processor.use(remarkHtmlArtifact)
  const math = withMath({ singleDollar: true })
  if (!math) throw new Error('Expected the Streamdown math plugin')
  processor.use({ plugins: [math.remarkPlugin] })
  return processor.runSync(processor.parse(source), source)
}

function mathNodes(source: string, htmlArtifact = false): Array<InlineMath | Math> {
  const nodes: Array<InlineMath | Math> = []
  visit(parse(source, htmlArtifact), (node) => {
    if (node.type === 'inlineMath' || node.type === 'math') nodes.push(node)
  })
  return nodes
}

function textValue(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code' || node.type === 'html') {
    return node.value
  }
  return 'children' in node ? node.children.map(textValue).join('') : ''
}

describe('remarkLatexMath', () => {
  it.each([
    ['The formula is \\(a+b=c\\)', 'inlineMath', 'a+b=c'],
    ['The formula is \\[a+b=c\\]', 'inlineMath', 'a+b=c'],
    ['\\[\na+b=c\n\\]', 'math', '\na+b=c\n'],
    ['\\[\\begin{aligned}x&=1\\end{aligned}\\]', 'math', '\\begin{aligned}x&=1\\end{aligned}'],
    ['\\[x=1\\tag{1}\\]', 'math', 'x=1\\tag{1}']
  ])('parses %s as %s', (source, type, value) => {
    expect(mathNodes(source)).toMatchObject([{ type, value }])
  })

  it('removes balanced nested delimiters from the value passed to KaTeX', () => {
    expect(mathNodes('\\(a + \\(b + c\\)\\)')).toMatchObject([{ type: 'inlineMath', value: 'a + b + c' }])
    expect(mathNodes('\\[outer \\[inner\\] formula\\]')).toMatchObject([
      { type: 'inlineMath', value: 'outer inner formula' }
    ])
    expect(mathNodes(String.raw`\(a + \\(b + c\\)\)`)).toMatchObject([
      { type: 'inlineMath', value: String.raw`a + \\(b + c\\)` }
    ])
  })

  it('renders nested delimiters through the real Markdown and KaTeX pipeline', () => {
    const math = withMath({ singleDollar: true })
    const { container } = render(
      createElement(Markdown, {
        id: 'nested-latex-delimiters',
        plugins: { ...defaultMarkdownPlugins, math },
        remarkPlugins: [remarkLatexMath],
        children: '\\(a + \\(b + c\\) + d\\)'
      })
    )

    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe('a + b + c + d')
  })

  it.each([
    'equation',
    'equation*',
    'align',
    'align*',
    'aligned',
    'gather',
    'gather*',
    'gathered',
    'multline',
    'multline*'
  ])('parses an independent %s environment as display math', (name) => {
    const source = `   \\begin{${name}}\nx=1\n\\end{${name}}，`
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([{ type: 'math', value: `\\begin{${name}}\nx=1\n\\end{${name}}` }])
    expect(textValue(tree)).toContain('，')
  })

  it('balances nested environments with the same name', () => {
    const source = '\\begin{aligned}\na\\begin{aligned}b\\end{aligned}c\n\\end{aligned}。'
    expect(mathNodes(source)).toMatchObject([
      {
        type: 'math',
        value: '\\begin{aligned}\na\\begin{aligned}b\\end{aligned}c\n\\end{aligned}'
      }
    ])
  })

  it('parses an independent environment after a CR-only line ending', () => {
    const source = 'Before formula.\r\\begin{equation}\rx=1\r\\end{equation}'
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([{ type: 'math', value: '\\begin{equation}\rx=1\r\\end{equation}' }])
    expect(textValue(tree)).toContain('Before formula.')
  })

  it('parses the multiline derivation from issue #19576 as one display node', () => {
    const source = `Here is a derivation:
\\[\\begin{aligned}
\\phi(t) &\\Longrightarrow \\left( \\frac{\\alpha}{\\beta} \\right) \\psi(t) \\\\
&= \\left( \\frac{1}{\\sqrt{2}} \\right) \\phi_0 \\tag{1}
\\end{aligned}\\]`

    expect(mathNodes(source)).toMatchObject([
      {
        type: 'math',
        value: expect.stringContaining('\\phi_0 \\tag{1}')
      }
    ])
  })

  it('leaves code, links, and HTML artifacts outside math parsing', () => {
    const source = [
      '`\\(inline\\)`',
      '',
      '```latex',
      '\\[fenced\\]',
      '```',
      '',
      '~~~latex',
      '\\begin{equation}x=1\\end{equation}',
      '~~~',
      '',
      '    \\[indented\\]',
      '',
      '[\\(label\\) and \\[pdf\\]](https://example.com/\\[path\\])',
      '',
      '<div>\\(html\\)</div>'
    ].join('\n')
    const tree = parse(source, true)

    expect(mathNodes(source, true)).toEqual([])
    expect(textValue(tree)).toContain('(label) and [pdf]')
    expect(tree.children.filter((node) => node.type === 'code')).toHaveLength(4)
  })

  it.each([
    '\\(unclosed',
    '\\[unclosed',
    '\\(mismatch\\]',
    '\\begin{align}x\\end{aligned}',
    '\\begin{unsupported}x\\end{unsupported}',
    '\\\\(double escaped\\\\)'
  ])('keeps incomplete or unsupported input as ordinary Markdown: %s', (source) => {
    expect(mathNodes(source)).toEqual([])
  })

  it('switches to math only after a streaming prefix is completely closed', () => {
    const source = '\\[\\begin{aligned}\nx&=1\n\\end{aligned}\\]'
    for (let end = 1; end < source.length; end += 1) {
      expect(mathNodes(source.slice(0, end))).toEqual([])
    }
    expect(mathNodes(source)).toMatchObject([{ type: 'math' }])
  })

  it('repairs a direct display formula without consuming the Markdown after it', () => {
    const source = [
      '$$\\begin{aligned}',
      'x&=1',
      '\\end{aligned}$$',
      '',
      'After formula.',
      '',
      '```latex',
      '\\(code\\)',
      '```',
      '',
      '[link](https://example.com)'
    ].join('\n')
    const tree = parse(source)
    const [node] = mathNodes(source)

    expect(node).toMatchObject({
      type: 'math',
      meta: null,
      value: '\\begin{aligned}\nx&=1\n\\end{aligned}',
      data: {
        hChildren: [
          {
            children: [{ type: 'text', value: '\\begin{aligned}\nx&=1\n\\end{aligned}' }]
          }
        ]
      }
    })
    expect(tree.children.map((child) => child.type)).toEqual(['math', 'paragraph', 'code', 'paragraph'])
    expect(tree.children[3]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'link' }] }]
    })

    const { container } = render(
      createElement(Markdown, {
        id: 'direct-display-followed-by-markdown',
        plugins: { ...defaultMarkdownPlugins, math: withMath({ singleDollar: true }) },
        remarkPlugins: [remarkLatexMath],
        children: '$$\\begin{aligned}\nx&=1\n\\end{aligned}$$\n\nAfter formula.\n\n[link](https://example.com)'
      })
    )
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.textContent).toContain('After formula.')
    expect(container.textContent).toContain('link')
  })

  it('preserves a leading tag in existing multiline display math', () => {
    const source = '$$\\tag{1}\nx=1\n$$'

    expect(mathNodes(source)).toMatchObject([{ type: 'math', meta: null, value: '\\tag{1}\nx=1' }])
  })

  it.each([
    ['$x$', 'inlineMath', 'x'],
    ['$$x$$', 'inlineMath', 'x'],
    ['$$\nx\n$$', 'math', 'x']
  ])('does not change canonical remark-math input %s', (source, type, value) => {
    expect(mathNodes(source)).toMatchObject([{ type, value }])
  })
})
