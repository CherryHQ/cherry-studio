import { render } from '@testing-library/react'
import type { InlineMath, Math, Nodes, Root } from 'mdast'
import { createElement } from 'react'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, expect, it, vi } from 'vitest'

import { defaultMarkdownPlugins, Markdown, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import { createLatexMarkdownBlockParser } from '../parseLatexMarkdownBlocks'

vi.unmock('@cherrystudio/ui')

function parse(source: string, gfm = false): Root {
  const processor = unified().use(remarkParse).use(remarkLatexMath)
  if (gfm) processor.use(remarkGfm)
  const math = withMath({ singleDollar: true })
  if (!math) throw new Error('Expected the Streamdown math plugin')
  processor.use({ plugins: [math.remarkPlugin] })
  return processor.runSync(processor.parse(source), source)
}

function mathNodes(source: string): Array<InlineMath | Math> {
  const nodes: Array<InlineMath | Math> = []
  visit(parse(source), (node) => {
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

  it.each(['\n', '\r\n', '\r'])('keeps standalone equals inside bracket math with %j line endings', (eol) => {
    const value = ['', 'x', '=', '-\\frac{b}{2a}', '\\pm', '\\frac{\\sqrt{b^2-4ac}}{2a}', ''].join(eol)
    const source = `\\[${value}\\]${eol}${eol}Next section${eol}=${eol}${eol}After formula.`
    const tree = parse(source)

    expect(tree.children).toMatchObject([
      { type: 'math', value },
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Next section' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'After formula.' }] }
    ])
  })

  it.each([
    ['indented', '   \\[\nx\n=\ny\n\\]', '\nx\n=\ny\n'],
    ['blockquote', '> \\[\n> x\n> =\n> y\n> \\]', '\nx\n=\ny\n'],
    ['list', '- \\[\n  x\n  =\n  y\n  \\]', '\nx\n=\ny\n'],
    ['nested delimiters', '\\[\nx + \\[y\\]\n=\nz\n\\]', '\nx + y\n=\nz\n']
  ])('protects Markdown-looking content in %s bracket math', (_label, source, value) => {
    const nodes = mathNodes(source)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: 'math',
      value
    })
  })

  it('does not close bracket math across a blockquote boundary', () => {
    const source = '> \\[\n> x\n> =\n\ny\n\\]\n\nNext section\n='

    expect(mathNodes(source)).toEqual([])
    expect(parse(source).children.at(-1)).toMatchObject({
      type: 'heading',
      children: [{ type: 'text', value: 'Next section' }]
    })
  })

  it.each([
    ['static', Markdown, '\n'],
    ['streaming', StreamingMarkdown, '\r\n']
  ] as const)('renders a split-line equation across a blank line through %s Markdown', (_label, Renderer, eol) => {
    const value = '\nx\n=\n\n-\\frac{b}{2a}\\pm\\frac{\\sqrt{b^2-4ac}}{2a}\n'
    const { container, getByRole } = render(
      createElement(Renderer, {
        id: 'split-line-equation',
        plugins: { ...defaultMarkdownPlugins, math: withMath({ singleDollar: true }) },
        remarkPlugins: [remarkLatexMath],
        parseMarkdownIntoBlocksFn: createLatexMarkdownBlockParser(),
        children: `## Before formula\n\n\\[${value}\\]\n\n## Next section`.replaceAll('\n', eol)
      })
    )

    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(value)
    expect(getByRole('heading', { name: 'Next section' })).toBeTruthy()
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

  it.each(['=', '---'])('keeps an environment with a lone %s line as one block', (line) => {
    const source = `\\begin{align}\na\n${line}\nb\n\\end{align}`

    expect(parse(source).children).toMatchObject([{ type: 'math', value: source }])
  })

  it.each(['.', ' trailing prose'])('does not scan past the first closer with%s', (suffix) => {
    const first = `\\begin{align}\na\n=\nb\n\\end{align}${suffix}`
    const second = '\\begin{align}\nc=d\n\\end{align}'
    const source = `${first}\n\n# Keep heading\n\n[Keep link](https://example.com)\n\n${second}`
    const tree = parse(source)
    expect(tree.children.some((child) => child.type === 'heading' && textValue(child).includes('Keep heading'))).toBe(
      true
    )
    expect(textValue(tree)).toContain('Keep link')
    expect(mathNodes(source).some((node) => node.value.includes('Keep heading'))).toBe(false)
    expect(mathNodes(source).some((node) => node.value === second)).toBe(true)
  })

  it('waits for the outer same-name closer across a sibling boundary', () => {
    const source = '\\begin{aligned}\na\n=\nb\n\\begin{aligned}\nc=d\n\\end{aligned}\n\nouter tail\n\\end{aligned}'
    expect(parse(source).children).toMatchObject([{ type: 'math', value: source }])
  })

  it('leaves many unclosed setext environments unchanged without searching later siblings', () => {
    const source = Array.from({ length: 4000 }, () => '\\begin{align}\na\n=\nb').join('\n\n')
    const tree = parse(source)
    expect(tree.children.some((node) => node.type === 'math')).toBe(false)
    expect(textValue(tree)).toContain('b')
  })

  it('leaves blockquote setext environments unrepaired rather than adding quote operators', () => {
    const source = '> \\begin{align}\n> a\n> =\n> b\n> \\end{align}'
    expect(mathNodes(source)).toEqual([])
    expect(parse(source).children[0].type).toBe('blockquote')
  })

  it.each(['- ', '1. '])('preserves clean environment repair in %s list items', (prefix) => {
    const indent = ' '.repeat(prefix.length)
    const source = `${prefix}item\n\n${indent}\\begin{align}\n${indent}a\n${indent}=\n${indent}b\n${indent}\\end{align}`
    expect(mathNodes(source)).toHaveLength(1)
    expect(mathNodes(source)[0].value).toContain('\\begin{align}')
  })

  it('preserves clean repair inside nested list items', () => {
    const source = '- outer\n  - inner\n\n    \\begin{align}\n    a\n    =\n    b\n    \\end{align}'
    expect(mathNodes(source)).toHaveLength(1)
  })

  it.each([
    '- item\n\n  > \\begin{align}\n  > a\n  > =\n  > b\n  > \\end{align}',
    '> - item\n>\n>   \\begin{align}\n>   a\n>   =\n>   b\n>   \\end{align}'
  ])('refuses quote prefixes through list or quote ancestors', (source) => {
    expect(mathNodes(source)).toEqual([])
  })

  it.each([
    ['indented code', '    \\end{align}'],
    ['fenced code', '```tex\n\\end{align}\n```'],
    ['inline code', '`\\end{align}`']
  ])('does not close an unmatched setext environment inside %s', (_label, code) => {
    const source = `\\begin{align}\na\n=\nb\n\n## Explanation\n\n[Reference](https://example.com)\n\n${code}`
    const tree = parse(source)
    expect(mathNodes(source)).toEqual([])
    expect(tree.children.some((node) => node.type === 'heading' && textValue(node) === 'Explanation')).toBe(true)
    const links: Nodes[] = []
    visit(tree, 'link', (node) => {
      links.push(node)
    })
    expect(links).toHaveLength(1)
    expect(textValue(tree)).toContain('\\end{align}')
  })

  it.each([
    ['quotation', '> A quotation\n> \\end{align}'],
    ['nested quotation', '> outer\n>> \\end{align}'],
    ['quotation in list', '- item\n\n  > A quotation\n  > \\end{align}']
  ])('does not close an outer setext environment inside a %s', (_label, quote) => {
    const source = `\\begin{align}\na\n=\nb\n\n## Explanation\n\n[Reference](https://example.com)\n\n${quote}`
    const tree = parse(source)
    expect(mathNodes(source)).toEqual([])
    expect(tree.children.some((node) => node.type === 'heading' && textValue(node) === 'Explanation')).toBe(true)
    const links: Nodes[] = []
    const quotes: Nodes[] = []
    visit(tree, 'link', (node) => {
      links.push(node)
    })
    visit(tree, 'blockquote', (node) => {
      quotes.push(node)
    })
    expect(links).toHaveLength(1)
    expect(quotes.length).toBeGreaterThan(0)
    expect(textValue(tree)).toContain('\\end{align}')
  })

  it.each([
    '\\begin{align}\na\n=\nb\n\n- item\n\n  \\end{align}',
    '- item\n\n  \\begin{align}\n  a\n  =\n  b\n\n\\end{align}',
    '- first\n\n  \\begin{align}\n  a\n  =\n  b\n\n- second\n\n  \\end{align}',
    '- outer\n\n  \\begin{align}\n  a\n  =\n  b\n\n  - inner\n\n    \\end{align}'
  ])('does not pair markers across list item ownership', (source) => {
    expect(mathNodes(source)).toEqual([])
    expect(textValue(parse(source))).toContain('\\end{align}')
  })

  it.each([
    ['footnote', '[^note]: The closing token is \\end{align}'],
    ['link definition', '[note]: https://example.com "\\end{align}"'],
    ['raw HTML', '<div>\n\\end{align}\n</div>']
  ])('does not close a body setext environment in %s', (_label, tail) => {
    const source = `See note[^note].\n\n\\begin{align}\na\n=\nb\n\n## Explanation\n\n[Reference](https://example.com)\n\n${tail}`
    const tree = parse(source, true)
    const math: Nodes[] = []
    const links: Nodes[] = []
    visit(tree, (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') math.push(node)
      if (node.type === 'link') links.push(node)
    })
    expect(math).toEqual([])
    expect(tree.children.some((node) => node.type === 'heading' && textValue(node) === 'Explanation')).toBe(true)
    expect(links).toHaveLength(1)
    expect(tree.children.some((node) => ['footnoteDefinition', 'definition', 'html'].includes(node.type))).toBe(true)
  })

  it('repairs a clean environment wholly inside a footnote', () => {
    const source = 'See note[^n].\n\n[^n]: \\begin{align}\n    a\n    =\n    b\n    \\end{align}'
    const tree = parse(source, true)
    const math: Nodes[] = []
    visit(tree, 'math', (node) => {
      math.push(node)
    })
    expect(math).toHaveLength(1)
    expect(tree.children.at(-1)?.type).toBe('footnoteDefinition')
  })

  it.each([
    'Command | Meaning\n--- | ---\nclose | \\end{align}',
    '| Command | Meaning |\n| --- | --- |\n| close | \\end{align} |',
    '- item\n\n  Command | Meaning\n  --- | ---\n  close | \\end{align}'
  ])('does not close a body setext environment inside a GFM table', (table) => {
    const source = `\\begin{align}\na\n=\nb\n\n## Explanation\n\n[Reference](https://example.com)\n\n${table}`
    const tree = parse(source, true)
    const math: Nodes[] = []
    const tables: Nodes[] = []
    const links: Nodes[] = []
    visit(tree, (node) => {
      if (node.type === 'math' || node.type === 'inlineMath') math.push(node)
      if (node.type === 'table') tables.push(node)
      if (node.type === 'link') links.push(node)
    })
    expect(math).toEqual([])
    expect(tables).toHaveLength(1)
    expect(links).toHaveLength(1)
    expect(tree.children.some((node) => node.type === 'heading' && textValue(node) === 'Explanation')).toBe(true)
  })

  it('ignores a closer inside a TeX percent comment', () => {
    const source = '\\begin{align}\na\n=\nb\n% \\end{align}\n\nc=d\n\\end{align}'
    expect(parse(source).children).toMatchObject([{ type: 'math', value: source }])
  })

  it('does not treat an escaped percent sign as a comment', () => {
    const source = '\\begin{align}\na\n=\nb\n\\% \\end{align}'
    expect(parse(source).children).toMatchObject([{ type: 'math', value: source }])
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

  it('parses a bracket display formula split by a blank line', () => {
    const source = [
      'Before formula.',
      '',
      '\\[',
      'h_{i}(\\mathbf{p})',
      '=',
      '',
      '\\frac{a}{c}',
      '\\]',
      '',
      'After formula.'
    ].join('\n')
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([{ type: 'math', value: '\nh_{i}(\\mathbf{p})\n=\n\n\\frac{a}{c}\n' }])
    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'math', 'paragraph'])
    expect(textValue(tree)).toContain('After formula.')
  })

  it('parses a blank-line bracket formula inside a block quote', () => {
    const source = ['> \\[', '> a', '>', '> b', '> \\]'].join('\n')

    expect(mathNodes(source)).toMatchObject([{ type: 'math', value: '\na\n\nb\n' }])
  })

  it('keeps a bracket formula inline when its line continues past the closing delimiter', () => {
    const source = '\\[a+b=c\\] and more text'
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([{ type: 'inlineMath', value: 'a+b=c' }])
    expect(textValue(tree)).toContain('and more text')
  })

  it('renders a blank-line bracket formula through the real Markdown and KaTeX pipeline', () => {
    const math = withMath({ singleDollar: true })
    const { container } = render(
      createElement(Markdown, {
        id: 'bracket-blank-line',
        plugins: { ...defaultMarkdownPlugins, math },
        remarkPlugins: [remarkLatexMath],
        children: '\\[\nE\n=\n\nmc^2\n\\]'
      })
    )

    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe('\nE\n=\n\nmc^2\n')
  })

  it('leaves code and links outside math parsing', () => {
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
      '[\\(label\\) and \\[pdf\\]](https://example.com/\\[path\\])'
    ].join('\n')
    const tree = parse(source)

    expect(mathNodes(source)).toEqual([])
    expect(textValue(tree)).toContain('(label) and [pdf]')
    expect(tree.children.filter((node) => node.type === 'code')).toHaveLength(3)
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

  it('bounds a multiline display fence whose opening line contains math', () => {
    const source = [
      "$$f(2h)=f(0)+f'(0)(2h)+\\frac{f''(0)}{2}(2h)^2+o(h^2)",
      "=f(0)+2f'(0)h+2f''(0)h^2+o(h^2)$$",
      '',
      'Text after the formula with $x$.',
      '',
      '$$',
      '\\begin{cases}',
      'x+y=1\\\\',
      'x+2y=0',
      '\\end{cases}',
      '$$',
      '',
      '# Heading',
      '',
      '[link](https://example.com)',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '<span>html</span>'
    ].join('\n')
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([
      {
        type: 'math',
        meta: null,
        value: expect.stringContaining("=f(0)+2f'(0)h+2f''(0)h^2+o(h^2)")
      },
      { type: 'inlineMath', value: 'x' },
      { type: 'math', value: expect.stringContaining('\\begin{cases}') }
    ])
    expect(tree.children.slice(0, 5).map((child) => child.type)).toEqual([
      'math',
      'paragraph',
      'math',
      'heading',
      'paragraph'
    ])
    expect(tree.children[1]).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Text after the formula with ' },
        { type: 'inlineMath', value: 'x' },
        { type: 'text', value: '.' }
      ]
    })
    expect(textValue(tree)).toContain('link')
    expect(textValue(tree)).toContain('| a | b |')
    expect(textValue(tree)).toContain('html')
  })

  it.each([
    ['$$x$$', 'inlineMath', 'x'],
    ['$$\nx\n$$', 'math', 'x'],
    ['$$x\ny$$', 'math', 'x\ny'],
    ['$$x\r\ny$$', 'math', 'x\r\ny']
  ])('keeps dollar math bounded for %s', (source, type, value) => {
    const tree = parse(`${source}\n\nAfter formula.`)

    expect(mathNodes(source)).toMatchObject([{ type, value }])
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph' })
    expect(textValue(tree)).toContain('After formula.')
  })

  it.each([
    ['LF', '$$x$$\n\nText with $$y$$'],
    ['CRLF', '$$x$$\r\n\r\nText with $$y$$'],
    ['trailing spaces', '$$x$$  \n\nText with $$y$$'],
    ['trailing tab', '$$x$$\t\n\nText with $$y$$']
  ])('leaves a first-line closing fence to the existing parser (%s)', (_label, source) => {
    const tree = parse(source)

    expect(mathNodes(source)).toMatchObject([
      { type: 'inlineMath', value: 'x' },
      { type: 'inlineMath', value: 'y' }
    ])
    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'Text with ' },
        { type: 'inlineMath', value: 'y' }
      ]
    })
  })

  it('preserves text and headings after math closed on its opening line', () => {
    const source = '$$x=1$$，这是说明文字。\n\n## Next section\n\nText with $$y=2$$'
    const tree = parse(source)

    expect(tree.children).toMatchObject([
      {
        type: 'paragraph',
        children: [
          { type: 'inlineMath', value: 'x=1' },
          { type: 'text', value: '，这是说明文字。' }
        ]
      },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Next section' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Text with ' },
          { type: 'inlineMath', value: 'y=2' }
        ]
      }
    ])
  })

  it('preserves a leading tag in existing multiline display math', () => {
    const source = '$$\\tag{1}\nx=1\n$$'

    expect(mathNodes(source)).toMatchObject([{ type: 'math', meta: null, value: '\\tag{1}\nx=1' }])
  })

  it('promotes single-line dollar math with display-only constructs (issue #20797)', () => {
    expect(mathNodes('$$\\tag{1} x=1$$')).toMatchObject([{ type: 'math', meta: null, value: '\\tag{1} x=1' }])
    expect(mathNodes('$$x=1 \\tag{1}$$')).toMatchObject([{ type: 'math', value: 'x=1 \\tag{1}' }])
    expect(mathNodes('$$price $5 \\tag{1}$$')).toMatchObject([{ type: 'inlineMath' }])
    expect(mathNodes('$$price \\$5 \\tag{1}$$')).toMatchObject([{ type: 'math', value: 'price \\$5 \\tag{1}' }])
    expect(mathNodes('Before $$\\tag{1}\nx=1$$ after')).toMatchObject([{ type: 'inlineMath' }])
    expect(mathNodes('$$x \\\\tag{1}$$')).toMatchObject([{ type: 'inlineMath' }])
    expect(parse('$$\\tag{1} x=1$$').children.map((child) => child.type)).toEqual(['math'])

    const { container } = render(
      createElement(Markdown, {
        id: 'single-line-tag-display',
        plugins: { ...defaultMarkdownPlugins, math: withMath({ singleDollar: true }) },
        remarkPlugins: [remarkLatexMath],
        children: '$$\\tag{1} x=1$$'
      })
    )
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('keeps single-dollar math with display-only constructs inline', () => {
    expect(mathNodes('$\\tag{1} x=1$')).toMatchObject([{ type: 'inlineMath' }])
  })

  it.each([
    ['$x$', 'inlineMath', 'x'],
    ['$$x$$', 'inlineMath', 'x'],
    ['$$\nx\n$$', 'math', 'x']
  ])('does not change canonical remark-math input %s', (source, type, value) => {
    expect(mathNodes(source)).toMatchObject([{ type, value }])
  })
})
