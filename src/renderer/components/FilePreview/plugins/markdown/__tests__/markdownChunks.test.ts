import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { rehypeHeadingIds } from '@cherrystudio/ui'

import { hasOversizedMarkdownChunk, MARKDOWN_MAX_BLOCK_CHARS, splitMarkdownChunks } from '../markdownChunks'

const joined = (chunks: Array<{ text: string }>) => chunks.map((chunk) => chunk.text).join('\n')
const chunksOf = (content: string, budgetChars?: number) => splitMarkdownChunks(content, budgetChars).chunks

/**
 * The definition copy the splitter hoists to the front of a chunk, which is where a definition
 * built from a failed title shows what it accumulated: the copy is the text up to the blank that
 * ends it, so a rollback that leaves rejected title lines behind writes them here.
 */
const hoistedDefinition = (content: string): string => joined(chunksOf(content)).split('\n\n')[0]

const parsed = (source: string) => unified().use(remarkParse).use(remarkGfm).parse(source)

/**
 * The ids a source's headings render with — `rehypeHeadingIds` over the parsed headings, which is
 * what a `#fragment` navigation resolves against. Chunks are compared on these rather than on the
 * slug map itself, so the whole path from source to rendered id is under test.
 */
const renderedHeadingIds = (source: string, slugs?: ReadonlyMap<string, readonly string[]>): string[] => {
  const tree = parsed(source) as unknown as { children: Array<{ type: string; depth?: number; children?: unknown[] }> }
  const root = {
    type: 'root',
    children: tree.children
      .filter((node) => node.type === 'heading')
      .map((node) => ({
        type: 'element',
        tagName: `h${node.depth}`,
        properties: {} as { id?: unknown },
        children: node.children
      }))
  }
  rehypeHeadingIds({ prefix: 'chunk', slugs })(root as never)
  return root.children.map((element) => String(element.properties.id))
}

/** The ids the chunks hand out in document order, which must read as the unsplit document's ids. */
const chunkHeadingIds = (content: string, budgetChars?: number): string[] =>
  chunksOf(content, budgetChars).flatMap((chunk) => renderedHeadingIds(chunk.text, chunk.headingSlugs))

/**
 * The destinations a source's references render as links to — mdast keeps a reference a
 * `linkReference` that remark-rehype resolves against the document's definitions, so a reference
 * the parser left literal text resolves to none.
 */
const resolvedReferenceUrls = (source: string): string[] => {
  const definitions = new Map<string, string>()
  const urls: string[] = []
  const walk = (
    node: { type: string; identifier?: string; url?: string; children?: unknown[] },
    phase: 'definitions' | 'references'
  ): void => {
    if (phase === 'definitions' && node.type === 'definition' && typeof node.url === 'string') {
      if (!definitions.has(node.identifier ?? '')) definitions.set(node.identifier ?? '', node.url)
    }
    if (phase === 'references' && node.type === 'linkReference') {
      const url = definitions.get(node.identifier ?? '')
      if (url !== undefined) urls.push(url)
    }
    for (const child of node.children ?? []) walk(child as never, phase)
  }
  walk(parsed(source), 'definitions')
  walk(parsed(source), 'references')
  return urls
}

/**
 * The numbers the ordered lists of a source render with. A list is one block: split apart, every
 * piece restarts at its own first marker and the numbering the document shows is lost.
 */
const renderedListNumbers = (source: string): number[] =>
  (
    parsed(source) as unknown as {
      children: Array<{ type: string; ordered?: boolean; start?: number; children?: unknown[] }>
    }
  ).children.flatMap((node) =>
    node.type === 'list' && node.ordered ? (node.children ?? []).map((_, index) => (node.start ?? 1) + index) : []
  )

describe('splitMarkdownChunks', () => {
  it('keeps a document that has no definitions lossless across its chunks', () => {
    const content = ['para one', '', 'para two', '', 'para three'].join('\n')

    expect(joined(chunksOf(content, 10))).toBe(content)
  })

  it('splits at blank lines once the chunk budget is spent', () => {
    const content = ['para one', '', 'para two', '', 'para three'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks.length).toBeGreaterThan(1)
    expect(joined(chunks)).toBe(content)
  })

  it('keeps a fenced code block that spans blank lines in one chunk', () => {
    // A boundary inside the fence would tear the code block in half and leave both chunks malformed.
    const content = ['opening paragraph', '', '```', 'code line', '', 'more code', '```', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('code line\n\nmore code')
  })

  it('keeps display math that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '$$', 'x = 1', '', 'y = 2', '$$', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('keeps dollar display math that opens with content on its line in one chunk', () => {
    const content = ['opening paragraph', '', '$$x = 1234567890', '', 'y = 2$$', '', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(3)
    expect(chunks[1].text).toContain('$$x = 1234567890\n\ny = 2$$')
  })

  it('keeps dollar display math built around a LaTeX environment in one chunk', () => {
    const content = ['opening paragraph', '', '$$\\begin{align}', 'x = 1', '', 'y = 2', '\\end{align}$$', ''].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('does not treat inline dollar math as a block a boundary could fall inside', () => {
    // `$$x = 1$$` closes on its own line, so the parser leaves it to the inline tokenizer.
    const content = ['opening paragraph', '', '$$x = 1$$ and text', '', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(3)
  })

  // The math tokenizer accepts a closing fence at least as long as the opener and rejects a shorter
  // one (`if (size < sizeOpen) return nok(code)` in micromark-extension-math), so the splitter's
  // `>=` mirrors it rather than requiring an exact match.
  it('closes dollar math on a longer fence but not on a shorter one', () => {
    const longer = ['opening paragraph', '', '$$x = 1234567890', '', 'y = 2$$$', '', 'after'].join('\n')
    const shorter = ['opening paragraph', '', '$$$x = 1234567890', '', 'y = 2$$', '', 'after'].join('\n')

    expect(chunksOf(longer, 10)).toHaveLength(3)
    expect(chunksOf(shorter, 10)).toHaveLength(2)
    expect(chunksOf(shorter, 10)[1].text).toContain('y = 2$$\n\nafter')
  })

  it('keeps the tail of a document in one chunk while its dollar math is unclosed', () => {
    // The parser reads an unclosed `$$` as math to the end of the document, so the splitter follows it.
    const content = ['opening paragraph', '', '$$x = 1', '', 'y = 2', '', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('y = 2\n\nafter')
  })

  // A CRLF document must window exactly like the same source with LF endings: every line-anchored
  // match here has to see the line without its `\r`, or a construct that should close never does and
  // one unclosed run suppresses every later boundary.
  it('windows a CRLF document whose dollar math closes on a later line', () => {
    const content = ['opening paragraph', '', '$$x = 1234567890', '', 'y = 2$$', '', 'after'].join('\r\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(3)
    expect(hasOversizedMarkdownChunk(chunks)).toBe(false)
  })

  it('keeps a CRLF blank-separated list in one chunk', () => {
    const content = ['opening paragraph', '', '- one', '', '- two', '', '- three', '', 'after'].join('\r\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(3)
    expect(chunks[1].text).toContain('- one\n\n- two\n\n- three')
  })

  it('carries a CRLF link reference definition whole', () => {
    const content = ['opening paragraph', '', '[label]: https://example.com', '"the title"', '', 'see [label]'].join(
      '\r\n'
    )

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('the title'))).toHaveLength(chunks.length)
  })

  it('keeps a raw HTML block that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '<pre>', 'raw one', '', 'raw two', '</pre>', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('raw one\n\nraw two')
  })

  it('keeps the html elements a blank line only spans in one chunk', () => {
    // A blank line ends the parser's HTML block, but not the element its opening tag began: a
    // boundary there closes `<details>` with only its summary inside and renders the body the next
    // chunk holds outside the disclosure.
    const content = 'filler\n\n'.repeat(3071) + '<details>\n<summary>Summary</summary>\n\nHidden content\n\n</details>'

    // At the default budget the blank behind the summary is the first one the spent buffer reaches,
    // so the construct is what holds the boundary off.
    expect(chunksOf(content).find((chunk) => chunk.text.includes('<details>'))?.text).toContain(
      '<details>\n<summary>Summary</summary>\n\nHidden content\n\n</details>'
    )

    // At a small budget the construct spans the boundary the summary's blank would otherwise be.
    const windowed = chunksOf(
      'para one\n\n' + '<details>\n<summary>Summary</summary>\n\nHidden content\n\n</details>',
      10
    )
    expect(windowed).toHaveLength(2)
    expect(windowed[1].text).toContain('<details>\n<summary>Summary</summary>\n\nHidden content\n\n</details>')
  })

  it('keeps the construct a self-closing non-void tag opens in one chunk', () => {
    // The renderer ignores a self-closing slash on an HTML element, so `<details/>` opens the
    // disclosure the same `<details>` does — the content below the summary renders inside it, and
    // a boundary at the summary's blank would close the chunk with the body outside.
    const content = 'filler\n\n'.repeat(3071) + '<details/>\n<summary>Summary</summary>\n\nHidden content\n\n</details>'

    expect(chunksOf(content).find((chunk) => chunk.text.includes('<details/>'))?.text).toContain(
      '<details/>\n<summary>Summary</summary>\n\nHidden content\n\n</details>'
    )

    const windowed = chunksOf(
      'para one\n\n' + '<details/>\n<summary>Summary</summary>\n\nHidden content\n\n</details>',
      10
    )
    expect(windowed).toHaveLength(2)
    expect(windowed[1].text).toContain('<details/>\n<summary>Summary</summary>\n\nHidden content\n\n</details>')
  })

  it('still windows behind a self-closing foreign element', () => {
    // Foreign content honors the slash — `<svg/>` is complete where it stands, so the blank below
    // it stays a boundary and the window keeps turning.
    const windowed = chunksOf('para one\n\n<svg width="1"/>\n\npara two', 10)

    expect(windowed).toHaveLength(3)
  })

  it('keeps scanning a tag whose quotes never close in time to window the document', () => {
    // A tag's attributes alternate between quoted runs and plain characters, so an unterminated tag
    // makes those alternatives overlap and a regex engine backtracks exponentially in the number of
    // quotes — the splitter stalled here before the fallback could guard the UI.
    const content = `<div ${'"x"'.repeat(20)}\n\nbody`

    const started = performance.now()
    const chunks = chunksOf(content)
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(500)
    // Twenty repetitions cost the regex over seven seconds and grew exponentially from there;
    // a linear scan finishes in one pass over the line.
    expect(chunks.join('')).not.toBe('')
    expect(joined(chunks)).toBe(content)
  })

  it('keeps scanning a line of stray quotes without stalling, at every size', () => {
    // The blowup is quadratic-per-quote, so a document a user could hold is the case that matters —
    // a hundred repetitions, not just the twenty that already tripped a cap.
    const content = `<div ${'"x"'.repeat(100)}\n\nbody`

    const started = performance.now()
    chunksOf(content)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('keeps windowing when a comment inside an HTML block holds a tag', () => {
    // The tags a comment carries are its own — a `<span>` mentioned inside one must not hold an
    // element open, or every later boundary stays off and the document falls to the plain-text
    // fallback as one indivisible block.
    const content = '<div>\n</div>\n<!-- <span> -->\n\n' + 'para\n\n'.repeat(6000) + 'tail'

    const chunks = chunksOf(content)

    expect(chunks.length).toBeGreaterThan(1)
    expect(hasOversizedMarkdownChunk(chunks)).toBe(false)
  })

  it('does not end a chunk on a blank line that an indented continuation follows', () => {
    // That blank line is part of the block above it — a footnote definition or indented code block.
    const content = ['opening paragraph', '', '    indented body', '', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks[0].text).toContain('indented body')
  })

  it('does not end a chunk inside a run of blank lines that indented code spans', () => {
    // One indented code block: only the last blank line before unindented text ends it.
    const content = ['opening paragraph', '', '    code one', '', '', '    code two', '', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toContain('code one\n\n\n    code two')
  })

  it('keeps an ordered list whose numbering a boundary would reset in one chunk', () => {
    // The list numbers its items from its first marker, so `1. 1. 1.` renders 1, 2, 3 as one list
    // and 1, 1, 1 as three documents.
    const content = ['1. first', '', '1. second', '', '1. third'].join('\n')

    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps the rest of an ordered list together once its numbering stops matching', () => {
    const content = ['1. first', '', '1. second', '', '2. third'].join('\n')

    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps an ordered list whose markers skip numbers in one chunk', () => {
    // `1. 3. 5.` renders 1, 2, 3 as one list, so the written numbers cannot carry across a boundary.
    const content = ['1. first', '', '3. second', '', '5. third'].join('\n')

    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps a blank-separated list in one chunk', () => {
    // A one-item chunk parses as a tight list, so the split pieces render without the paragraph
    // that a loose list wraps every item in.
    const content = ['- first', '', '- second', '', '- third'].join('\n')

    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps a list whose items change their legal indentation in one chunk', () => {
    // An item written at any column up to three stays a sibling of the list its marker names, so
    // `  1. first` and a column-zero `1. second` render 1, 2 as one list — a boundary there
    // renumbers the second into its own list starting at 1.
    const content = ['  1. first', '', '1. second'].join('\n')

    expect(renderedListNumbers(content)).toEqual([1, 2])
    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps a list whose later item is indented deeper but not into the item in one chunk', () => {
    // The first item's content starts at column three, so a marker at column two is still a
    // sibling — the numbering the document gives spans the blank the boundary would sit on.
    const content = ['1. first', '', '  1. second'].join('\n')

    expect(renderedListNumbers(content)).toEqual([1, 2])
    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('keeps a nested list inside the item that holds it in one chunk', () => {
    // A marker indented to the item's content column opens a list of its own inside the item, so
    // the blank before it sits inside a construct: cutting there would strand the nested list at
    // the top level of the chunk that follows.
    const content = ['- first', '', '  - nested'].join('\n')

    expect(chunksOf(content, 1)).toHaveLength(1)
  })

  it('still windows between a list and the blocks around it', () => {
    const content = ['para one', '', '1. first', '1. second', '', 'para two', '', 'para three'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks).toHaveLength(4)
    expect(chunks[1].text).toContain('1. first\n1. second')
  })

  it('keeps a definition list term and the description its blank line introduces in one chunk', () => {
    // The renderer reads the paragraph above the blank as the term of the description below it, so
    // the construct spans the blank — cut there, the description renders the plain paragraph it is
    // only without its term.
    const content = 'filler\n\n'.repeat(3071) + 'Apple term\n\n: Fruit\n'

    // At the default budget the term's blank is the first one the spent buffer reaches.
    expect(chunksOf(content).find((chunk) => chunk.text.includes('Apple term'))?.text).toContain(
      'Apple term\n\n: Fruit'
    )

    // At a small budget the blank windows freely before the term, but not between the two.
    const windowed = chunksOf('para one\n\n' + 'Apple term\n\n: Fruit\n', 10)
    expect(windowed).toHaveLength(2)
    expect(windowed[1].text).toContain('Apple term\n\n: Fruit')
  })

  it('still windows the lists of a document where a heading ends the first one', () => {
    const content = ['1. first', '', '1. second', '', '# heading', '', '1. third', '', '2. fourth'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks).toHaveLength(3)
    expect(chunks[0].text).toContain('1. first\n\n1. second')
    expect(chunks[2].text).toContain('1. third\n\n2. fourth')
  })

  it('carries a link reference definition into the chunk that uses it', () => {
    // A chunk is its own document, so a reference whose definition lives elsewhere renders literally.
    const content = ['[label]: https://example.com', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com')
    }
  })

  it('carries a link reference definition whose destination sits on its own line', () => {
    // `[label]:` alone is no definition, so the run has to travel whole or the reference degrades.
    const content = ['[label]:', 'https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]:\nhttps://example.com')
    }
  })

  it('carries a link reference definition that runs to a title on its own line', () => {
    const content = ['[label]:', 'https://example.com', '"the title"', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]:\nhttps://example.com\n"the title"')
    }
  })

  it('carries a definition out of the block quote that holds it, without the quote', () => {
    // A definition belongs to the document, so one written in a quote still serves every chunk —
    // but the quote itself is a block of its own chunk, and carrying it would render an empty one.
    const content = ['> [label]: https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com')
    }
    // The definition is carried bare; only the chunk that holds the quote shows it.
    expect(chunks.filter((chunk) => chunk.text.includes('> [label]'))).toHaveLength(1)
  })

  it('carries a definition out of the list item that holds it, without the marker', () => {
    const content = ['- [label]: https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('- [label]'))).toHaveLength(1)
  })

  it('carries a block-quoted definition that runs to its destination and title on later lines', () => {
    const content = ['> [label]:', '> https://example.com', '> "the title"', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]:\nhttps://example.com\n"the title"')
    }
  })

  it('carries a definition whose label holds an escaped closing bracket', () => {
    // `[a\]b]` is a label for `a]b`; a label pattern that stops at the first bracket drops the run.
    const content = ['[a\\]b]: https://example.com', '', 'para one', '', 'see [a\\]b]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[a\\]b]: https://example.com')
    }
  })

  it('carries a definition whose label is exactly as long as the parser allows', () => {
    // 999 characters is the longest label CommonMark accepts, counted in the source the label was
    // written in rather than in the text it resolves to.
    const label = 'x'.repeat(999)
    const content = [`[${label}]: https://example.com`, '', 'para one', '', `see [${label}]`].join('\n')

    expect(parsed(`[${label}]: https://example.com`).children[0].type).toBe('definition')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain(`[${label}]: https://example.com`)
    }
  })

  it('does not carry a label the parser is too long to read as a definition', () => {
    // One character past the limit the bracket run is no label at all, so the line is a paragraph
    // the document renders once — carrying it printed that copy in front of every chunk.
    const label = 'x'.repeat(1000)
    const content = [`[${label}]: /url`, '', 'para one', '', `see [${label}]`].join('\n')

    expect(parsed(`[${label}]: /url`).children[0].type).toBe('paragraph')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes(']: /url'))).toHaveLength(1)
  })

  it('carries a definition whose label wraps to the line below', () => {
    // The parser reads the label whole and normalizes its line ending to whitespace, so the
    // wrapped reference matches; collecting no definition degraded the reference to literal text.
    const content = [
      '[foo',
      'bar]: https://example.com/url',
      '',
      'filler paragraph that spends the budget',
      '',
      'see [foo bar]'
    ].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[foo\nbar]: https://example.com/url')
    }
  })

  it('does not carry a wrapped label a blank line takes out of the definition', () => {
    // A definition is one block, so the blank ends the label's span and both lines are paragraphs.
    const content = ['[foo', '', 'bar]: https://example.com/url', '', 'see [foo bar]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('bar]: https://example.com/url'))).toHaveLength(1)
  })

  it('carries a wrapped label whose closing line renders as a definition the reference resolves', () => {
    // The closing line contributes its label content only: appending the closing syntax to a span
    // that still held the line's own `]: destination` rebuilt `[foo\nbar]: /url]: /url`, which the
    // parser refuses — so `see [foo bar]` rendered as literal text where the document links it.
    const content = [
      '[foo',
      'bar]: https://example.com/url',
      '',
      'filler paragraph that spends the budget',
      '',
      'see [foo bar]'
    ].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    // The definition registers wherever it is carried, the way the document's own does.
    expect(referenceTarget(content, 'foo bar')).toBe('https://example.com/url')
    expect(referenceTarget(joined(chunks), 'foo bar')).toBe('https://example.com/url')
    // And the reference renders as a link to it, not as the literal brackets.
    for (const chunk of chunks) {
      if (chunk.text.includes('see [foo bar]'))
        expect(resolvedReferenceUrls(chunk.text)).toEqual(['https://example.com/url'])
    }
  })

  it('does not hoist prose that only resembles the tail of a wrapped label', () => {
    // `hello]: /url` never opens a label; collecting a wrapped definition anyway dropped the `h`,
    // built `[ello]: /url]...` and prepended it to every chunk — text the document does not render.
    const content = ['hello]: https://example.com/url', '', 'world'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(joined(chunks)).toBe(content)
    expect(chunks[0].text.startsWith('hello')).toBe(true)
  })

  it('carries a wrapped label whose destination sits a line below the closing one', () => {
    // The label spans two lines and the second carries the colon, so the destination is the line
    // below it. Reading that line from the first line's index rebuilt `[foo\nbar]:\nbar]:`, whose
    // `bar]:` destination shadowed the real `/url` — the reference rendered `bar%5D:` instead.
    const content = ['[foo', 'bar]:', '/url', '', 'filler paragraph that spends the budget', '', 'see [foo bar]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(referenceTarget(content, 'foo bar')).toBe('/url')
    expect(referenceTarget(joined(chunks), 'foo bar')).toBe('/url')
    for (const chunk of chunks) {
      if (chunk.text.includes('see [foo bar]')) expect(resolvedReferenceUrls(chunk.text)).toEqual(['/url'])
    }
  })

  it('keeps an angle-bracket destination whose closing delimiter is escaped', () => {
    // A `\>` inside an angle-bracketed destination is an escaped delimiter, not the close: the
    // destination runs to the unescaped `>` that follows. Reading the escaped one as the close
    // left `b>` standing where a title belongs, so the definition was refused, never carried, and
    // the reference across the chunk boundary rendered as literal brackets.
    const content = [
      '[x]: <https://example.com/a\\>b>',
      '',
      'filler paragraph that spends the budget',
      '',
      'see [x]'
    ].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    // The unsplit document resolves the reference, so the chunked one has to as well.
    expect(referenceTarget(content, 'x')).toBe('https://example.com/a>b')
    expect(referenceTarget(joined(chunks), 'x')).toBe('https://example.com/a>b')
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [x]'))
    expect(referencing).toHaveLength(1)
    expect(resolvedReferenceUrls(referencing[0].text)).toEqual(['https://example.com/a>b'])
  })

  it('refuses an angle-bracket destination holding an unescaped <', () => {
    // remark reads `[x]: <a<b>` as a paragraph, not a definition: an angle destination may not
    // hold a bare `<`. The scanner accepted it, so the line was hoisted into later chunks as a
    // carried definition and its text printed once per chunk instead of once in the document.
    const content = `${'[x]: <a<b>\n\n'}${'filler\n\n'.repeat(3_072)}see [x]\n`

    const chunks = chunksOf(content)
    const occurrences = joined(chunks).split('[x]:').length - 1

    expect(referenceTarget(content, 'x')).toBeNull()
    expect(occurrences).toBe(1)
  })

  it('does not carry the quoted text that follows a block-quoted definition', () => {
    // Only the definition travels; `visible tail` is a paragraph of the quote and would be repeated.
    const content = ['> [label]: https://example.com', '> "the title"', '> visible tail', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    // The definition travels whole; the paragraph the quote holds afterwards does not.
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com\n"the title"')
      expect(chunk.text.split('\n\n')[0]).not.toContain('visible tail')
    }
  })

  it('carries a footnote definition into the chunk that uses it', () => {
    const content = ['[^1]: the note', '', 'see the note[^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: the note')
    }
  })

  it('leaves a footnote-shaped line whose label holds whitespace the paragraph it is', () => {
    // GFM reads no whitespace inside a footnote label, so `[^see below]:` is ordinary text the
    // document renders once — carrying it as a definition would print the paragraph twice.
    const content = ['[^see below]: ordinary text', '', 'body'].join('\n')

    const tree = parsed(content) as { children: Array<{ type: string }> }
    expect(tree.children.some((node) => node.type === 'footnoteDefinition')).toBe(false)

    expect(chunksOf(content, 1).length).toBeGreaterThan(1)
    expect(joined(chunksOf(content, 1))).toBe(content)
  })

  it('carries a footnote definition out of the block quote that holds it, without the quote', () => {
    // The parser registers a definition written in a quote for the whole document, so a reference in
    // another chunk needs it too — but the quote is a block of the chunk it was written in, and
    // carrying it would render an empty one.
    const content = ['> [^1]: the note', '', 'para one', '', 'see the note[^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: the note')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('> [^1]'))).toHaveLength(1)
  })

  it('carries a footnote definition out of the list item that holds it, without the marker', () => {
    const content = ['- [^1]: the note', '', 'para one', '', 'see the note[^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: the note')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('- [^1]'))).toHaveLength(1)
  })

  it('carries a multi-paragraph footnote definition out of the quote that holds it, in full', () => {
    // The definition is carried without its quote marker, so its continuation lines must lose theirs
    // too — the carried prefix then holds both paragraphs, and the definition the parser registered
    // first is whole rather than shadowed by a truncated copy of itself.
    const content = ['> [^n]: first', '>', '>     second', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^n]: first\n\n    second')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('> [^n]'))).toHaveLength(1)
  })

  it('carries a definition whose title escapes its own delimiter', () => {
    // An escaped quote is part of the title, so the definition is a definition; read as a closing
    // delimiter it would fail the title shape and the reference would degrade to literal text.
    const content = ['[a]: /url "say \\"hi\\""', '', 'see [a]', ''].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[a]: /url "say \\"hi\\""')
    }
  })

  it('carries a definition whose title escapes a parenthesis', () => {
    const content = ['[a\\]b]: /url (a \\) b)', '', 'see [a\\]b]', ''].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[a\\]b]: /url (a \\) b)')
    }
  })

  it('carries a definition whose title wraps from the line its destination is on', () => {
    // The parser closes a title on whichever line carries the closing delimiter, so a title that
    // opens on the destination's line runs on to the next one. Reading it as unclosed left the
    // definition out entirely, and every chunk then rendered its reference as literal text.
    const content = ['[label]: https://example.com "the long', 'spec title"', '', 'para one', '', 'see [label]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com "the long\nspec title"')
    }
  })

  it('carries a definition whose title wraps from the line below its destination', () => {
    // The same wrap, opening a line later: only the first line of the title was being taken, so the
    // definition reached every chunk without the paragraph the parser holds it to.
    const content = ['[label]:', 'https://example.com', '"the long', 'spec title"', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('https://example.com\n"the long\nspec title"')
    }
  })

  it('keeps the destination-only definition a next-line title abandons', () => {
    // A title that opens on the line below the destination and never closes leaves the definition
    // the destination-only one the parser accepted before the attempt — rejecting it whole left
    // the reference literal in every chunk it reached.
    const content = '[label]: /right\n"never closed\n\n' + 'filler\n\n'.repeat(3071) + 'see [label]'

    const chunks = chunksOf(content)

    expect(chunks.length).toBeGreaterThan(1)
    const last = chunks[chunks.length - 1]
    expect(last.text).toContain('see [label]')
    expect(resolvedReferenceUrls(last.text)).toEqual(['/right'])
    // The same failure on the destination's own line is still no definition at all: the leftover
    // title text is what the whole line renders as.
    expect(resolvedReferenceUrls('[label]: /right "abc"def\n\nsee [label]')).toEqual([])
  })

  it('leaves a paragraph that a blank line starts out of the definition behind it', () => {
    // Across a blank line the parser holds a footnote definition open only at four columns, so a
    // line indented less is a paragraph of its own. Carried, it was printed in every chunk.
    const content = ['[^note]: first', '', '  second', '', 'tail'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(joined(chunks).match(/second/g)).toEqual(['second'])
  })

  it('still carries the paragraph a footnote definition holds at four columns', () => {
    // The guard above has to stop at the indent the parser stops at, not at the first space.
    const content = ['[^note]: first', '', '    second', '', 'tail'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^note]: first')
      expect(chunk.text).toContain('    second')
    }
  })

  it('measures a tab-indented continuation in columns, not in characters', () => {
    // A tab advances to the next multiple of four, so two of them indent further than the four
    // spaces the guard above accepts. Measured as characters they read as too shallow, and the
    // paragraph the parser holds inside the definition went missing from every later chunk.
    const content = ['[^note]: first', '', '\t\tsecond', '', 'tail'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^note]: first')
      expect(chunk.text).toContain('\t\tsecond')
    }
  })

  it('leaves a fenced block that breaks a never-closing title out of the definition behind it', () => {
    // The fence ends the construct the parser is reading, so this is not a definition at all. Read
    // as a title that runs on, its code block was carried into every chunk and printed each time.
    const content = ['[spec]: /url "the long', '```', 'code', '```', 'spec title"', '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(joined(chunks).match(/code/g)).toEqual(['code'])
  })

  it('keeps a list whose leading items are definitions in one chunk', () => {
    // `- a` / `- b` / `- c` is one loose list; a boundary between them would render two lists and
    // the tail would lose the numbering the whole document gave it.
    const content = ['- [a]: /one', '- [b]: /two', '', '- real item', '', 'tail'].join('\n')

    const chunks = chunksOf(content, 24)

    const withList = chunks.filter((chunk) => chunk.text.includes('- real item'))
    expect(withList).toHaveLength(1)
    expect(withList[0].text).toContain('- [a]: /one\n- [b]: /two\n\n- real item')
  })

  it('keeps a list whose leading item is a footnote definition in one chunk', () => {
    const content = ['- [^1]: the note', '', '- real item', '', 'tail'].join('\n')

    const chunks = chunksOf(content, 12)

    const withList = chunks.filter((chunk) => chunk.text.includes('- real item'))
    expect(withList).toHaveLength(1)
    expect(withList[0].text).toContain('- [^1]: the note\n\n- real item')
  })

  it('measures a carried definition by the lines it covers', () => {
    // The estimate drives the virtualizer before a chunk is measured, so a definition that spans
    // three lines has to count as three — otherwise the chunk is placed a third too high.
    const content = ['[a]:', '   /url', '   "a title"', '', 'body one', '', 'body two'].join('\n')

    const chunks = chunksOf(content, 30)

    for (const chunk of chunks) {
      expect(chunk.lines).toBe(chunk.text.split('\n').length)
    }
  })

  it('measures a carried footnote definition by the lines it covers', () => {
    // Same estimate contract as the link definition above, for the other definition kind: a
    // footnote continues on indented lines, so one entry can cover several.
    const content = ['[^1]: first line', '    second line', '    third line', '', 'body one', '', 'body two'].join('\n')

    const chunks = chunksOf(content, 30)

    for (const chunk of chunks) {
      expect(chunk.lines).toBe(chunk.text.split('\n').length)
    }
  })

  it('measures a carried footnote definition that spans its own blank line', () => {
    const content = ['[^1]: para one', '', '    para two', '', 'body one', '', 'body two'].join('\n')

    const chunks = chunksOf(content, 30)

    for (const chunk of chunks) {
      expect(chunk.lines).toBe(chunk.text.split('\n').length)
    }
  })

  it('carries a definition with an indented continuation line', () => {
    const content = ['[^1]: first line', '    second line', '', 'see [^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: first line\n    second line')
    }
  })

  it('does not carry visible text that shares a block with a definition', () => {
    // Only definitions render nothing everywhere else; hoisting the paragraph would duplicate it.
    const content = ['[label]: https://example.com', 'visible tail text', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('visible tail text'))).toHaveLength(1)
  })

  it('does not carry a definition-shaped line that continues a paragraph', () => {
    // A link reference definition cannot interrupt a paragraph, so the line under `paragraph` is
    // paragraph text. Hoisting it put the wrong destination above the real definition, and the
    // first definition wins — even in a single small chunk.
    const content = [
      'paragraph',
      '[label]: https://example.com/wrong',
      '',
      '[label]: https://example.com/right',
      '',
      '[label]'
    ].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: https://example.com/right\n\n')).toBe(true)
  })

  it('keeps paragraph state for the shallow indent of the line a definition shape follows', () => {
    // One to three columns of indent is still a paragraph, so the definition-shaped line under it
    // is paragraph text. Reading the indent as code reset that state and hoisted the wrong
    // destination above the real definition, which the first definition wins.
    const content = [
      ' paragraph',
      '[label]: https://example.com/wrong',
      '',
      '[label]: https://example.com/right',
      '',
      'see [label]'
    ].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.at(-1)?.text.startsWith('[label]: https://example.com/right\n\n')).toBe(true)
    expect(chunks.filter((chunk) => chunk.text.includes('/wrong'))).toHaveLength(1)
  })

  it('still resets paragraph state behind a line indented into code', () => {
    // Four columns is indented code, a block of its own — the definition below it opens freely.
    const content = ['\tparagraph', '[label]: https://example.com/target', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })

  it('keeps paragraph state behind the indented line a paragraph continues', () => {
    // Indented code cannot interrupt a paragraph, so `    continuation` is the open paragraph's
    // own line and `[label]: /wrong` under it is paragraph text. Reading the indent as code reset
    // paragraph state, hoisted the wrong definition, and it shadowed the real `/right`.
    const content = ['paragraph', '    continuation', '[label]: /wrong', '', '[label]: /right', '', 'see [label]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(referenceTarget(content, 'label')).toBe('/right')
    expect(referenceTarget(joined(chunks), 'label')).toBe('/right')
    expect(chunks.filter((chunk) => chunk.text.includes('/wrong'))).toHaveLength(1)
  })

  it('still carries a definition-shaped line a quote marker opens behind a paragraph', () => {
    // The quote interrupts the paragraph, and the definition inside it is the document's own.
    const content = ['paragraph', '> [label]: https://example.com/target', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })

  it('still carries a footnote definition written right after a paragraph line', () => {
    // A footnote definition can interrupt a paragraph where a link reference definition cannot.
    const content = ['paragraph', '[^n]: note', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^n]: note')
    }
  })

  it('does not carry the indented text that follows a complete link definition', () => {
    // Only the destination's title belongs to the definition; the rest is a block of its own.
    const content = [
      '[label]: https://example.com',
      '    "the title"',
      '    visible tail text',
      '',
      'para one',
      '',
      'see [label]'
    ].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('visible tail text'))).toHaveLength(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com\n    "the title"')
    }
  })

  it('carries a definition nested behind a block quote and a list marker', () => {
    // Both markers are the definition's own container, so one alternation that stops after a quote
    // or after a list marker never matches the pair and the reference degrades to literal text.
    const content = ['> - [label]: https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com')
    }
  })

  it('carries a definition whose destination follows a container marker of its own', () => {
    // `[label]:` opens no definition, so the destination one line down is what makes it one — the
    // list item is what the parser reads to know the line continues rather than starting a list.
    const content = ['- [label]:', '  https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]:\n  https://example.com')
    }
  })

  it('does not read a container marker as the destination of a bare label line', () => {
    // The parser stops the definition at the marker: it opens a list or quote instead, so carrying
    // the marker as a destination would invent a link the base parser does not create.
    const content = ['[label]:', '- not a destination', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).not.toContain('[label]: - not a destination')
    }
  })

  it('does not carry a definition whose continuation is deeper than the container that holds it', () => {
    // `> >` opens a second quote rather than continuing the first, so the destination is a block of
    // its own and hoisting it would print it in every chunk.
    const content = ['> [label]:', '> > https://example.com', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('https://example.com'))).toHaveLength(1)
  })

  it('carries a definition whose destination is followed by a paragraph', () => {
    // Only the title may follow the destination, but text on a later line is a block of its own —
    // so the definition stands and the paragraph stays behind rather than sinking it.
    const content = ['[label]:', 'https://example.com', 'more text', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]:\nhttps://example.com')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('more text'))).toHaveLength(1)
  })

  it('does not carry a label line that opens no definition', () => {
    // `[label]:` with no destination is a paragraph, so hoisting it would print it in every chunk.
    const content = ['[label]:', 'not a destination here', '', 'para one', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('not a destination here'))).toHaveLength(1)
  })

  it('splits every chunk at the budget rather than every paragraph after the first', () => {
    // Without a reset, the budget stops being spent once and every later paragraph becomes a chunk.
    const content = Array.from({ length: 10 }, (_, i) => `paragraph-${i + 1}`).join('\n\n')

    const chunks = chunksOf(content, 60)

    expect(chunks).toHaveLength(2)
  })

  it('keeps bracket display math that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '\\[', 'x = 1', '', 'y = 2', '\\]', 'after'].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('keeps bracket display math whose delimiters nest in one chunk', () => {
    // The parser counts a nested `\[`/`\]` pair, so the outer formula ends at its second `\]` and
    // a boundary after the inner one would leave both chunks with a stray delimiter.
    const content = ['opening paragraph', '', '\\[', 'x = 1', '\\[', 'y = 2', '\\]', '', 'z = 3', '\\]', 'after'].join(
      '\n'
    )

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('\\[\nx = 1\n\\[\ny = 2\n\\]\n\nz = 3\n\\]')
  })

  it('keeps a LaTeX environment that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '\\begin{align}', 'x = 1', '', 'y = 2', '\\end{align}', 'after'].join(
      '\n'
    )

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('keeps a LaTeX environment whose repeat nests in one chunk', () => {
    // The parser counts a repeated `\begin{align}`, so the outer one ends at its second `\end{align}`.
    const content = [
      'opening paragraph',
      '',
      '\\begin{align}',
      'x = 1',
      '\\begin{align}',
      'y = 2',
      '\\end{align}',
      '',
      'z = 3',
      '\\end{align}',
      'after'
    ].join('\n')

    const chunks = chunksOf(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('\\end{align}\n\nz = 3\n\\end{align}')
  })

  it('carries a multi-paragraph footnote definition in full', () => {
    const content = ['[^1]: first paragraph', '', '    second paragraph', '', 'see [^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: first paragraph\n\n    second paragraph')
    }
  })

  it('carries a footnote definition across the blank lines that separate its paragraphs', () => {
    const content = ['[^1]: first paragraph', '', '', '    second paragraph', '', 'see [^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: first paragraph\n\n\n    second paragraph')
    }
  })

  it('carries a footnote definition whose opening paragraph wraps without indent', () => {
    // A line the note's four columns fall short of still continues its paragraph lazily; dropping
    // it truncated the footnote in every chunk that references it.
    const content = ['[^n]: first', 'second', '', 'filler paragraph that spends the budget', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^n]: first\nsecond')
    }
  })

  it('carries a lazy line that continues a quoted footnote definition without its marker', () => {
    const content = ['> [^n]: first', 'second', '', 'filler paragraph that spends the budget', '', 'see [^n]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^n]: first\nsecond')
    }
    expect(chunks.filter((chunk) => chunk.text.includes('> [^n]'))).toHaveLength(1)
  })

  it('does not carry a lazy line a blank line takes out of the footnote definition', () => {
    // Laziness continues an open paragraph; past a blank the line starts a block of its own.
    const content = ['[^n]: first', '', 'second', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('second'))).toHaveLength(1)
  })

  it('does not carry a code block that only follows a link definition', () => {
    // A footnote definition owns its indented lines; a link definition ends with its line run.
    const content = ['[label]: https://example.com', '', '    indented body', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('indented body'))).toHaveLength(1)
  })

  it('does not carry definition syntax found inside a fenced code block', () => {
    const content = ['```', '[label]: https://example.com', '```', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('https://example.com'))).toHaveLength(1)
  })

  it('carries a definition whose multi-line title holds a bare tag the parser keeps inside it', () => {
    // A type-7 tag cannot interrupt a paragraph, so `<a>` stays title text and the definition runs
    // on to the closing quote. Reading it as a block of its own truncated the definition to the one
    // line before it, which every chunk but that one then lacked — so the reference rendered
    // literally instead of as a link.
    const content = ['[spec]: /url "the long', '<a>', 'spec title"', '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes('[spec]: /url "the long\n<a>\nspec title"'))).toHaveLength(
      chunks.length
    )
  })

  it('does not repeat the definition line an unterminated raw HTML block swallows', () => {
    // `<?` opens an HTML block, and nothing here closes it, so the parser swallows the rest of the
    // document — title included. Carrying that title into every chunk printed it once per chunk.
    const content = ['[spec]: /url "the long', '<?php echo 1;', 'spec title"', '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('[spec]: /url "the long'))).toHaveLength(1)
  })

  it('does not carry an indented heading that the footnote definition does not own', () => {
    // The footnote's indented continuation holds four columns, so a shallower heading is a block of
    // its own. Taking it for definition text printed the heading once per chunk.
    const content = ['[^n]: note', ' # heading', '', 'tail', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('# heading'))).toHaveLength(1)
  })

  it('carries a definition whose title holds a tag-shaped run the parser reads as prose', () => {
    // `<div"x>` is no HTML block — the name has to end at whitespace, `>` or `/>` — so the title
    // runs on to its closing quote. Matching any character after the name truncated the
    // definition to the line before it and left every later chunk without it. (The title is
    // single-quoted because the run's own `"` would close a double-quoted one first.)
    const content = ["[spec]: /url 'the long", '<div"x marks the spot', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
  })

  it('carries an indented list as content of the footnote definition that owns it', () => {
    // Four columns of indent is footnote content, where the list opens inside the footnote — only
    // a marker at three columns or less closes the definition and starts a list of its own.
    // Reading the indented item as a block dropped it from every chunk but the first.
    const content = ['[^n]: note', '    - item', 'more note', '', 'tail', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes('    - item'))).toHaveLength(chunks.length)
  })

  it('carries a definition across a closing or self-closing raw tag in its title', () => {
    // `</pre>` and `<pre/>` are type 7 to the parser — only the plain opening `<pre>` opens a raw
    // block — so the title runs across them to its closing quote.
    const forms = ['</pre> marks the spot', '<pre/> marks the spot']
    for (const form of forms) {
      const content = ['[spec]: /url "the long', form, 'tail of title"', '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes('[spec]: /url "the long'))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a label line a lowercase declaration breaks', () => {
    // A declaration starts with any ASCII letter, not only an uppercase one, so `<!doctype` ends
    // the would-be definition — reading the line as a continuation carried a pseudo-definition.
    const content = ['[a]:', '<!doctype html>', '', 'para one', '', 'see [a]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('[a]:'))).toHaveLength(1)
  })

  it('carries a definition across a slash the parser does not complete into a tag', () => {
    // `<div/ >` ends a type-6 name only if the `>` follows the slash directly, so the parser reads
    // it as prose and the title runs on to its closing quote. Taking the lone slash for the name's
    // end truncated the definition to the line before it and left every later chunk without it.
    const forms = ['<div/ > marks the spot', '<div/x> marks the spot']
    for (const form of forms) {
      const content = ["[spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('carries a definition across an ordered marker that cannot interrupt it', () => {
    // A paragraph is interrupted by an ordered marker only when it is numbered 1, so `2.` stays
    // title text and the title runs on to its closing quote. Reading any number as an interrupting
    // marker truncated the definition to the line before it and left every later chunk without it.
    const forms = ['2. item marks the spot', '2) item marks the spot']
    for (const form of forms) {
      const content = ["[spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('carries a definition across an empty list item that cannot interrupt it', () => {
    // An empty item cannot interrupt a paragraph, so a bare marker line stays title text and the
    // title runs on to its closing quote. Reading the marker alone as an interrupt truncated the
    // definition to the line before it and left every later chunk without it.
    const forms = ['1. ', '1.  \t', '*  ']
    for (const form of forms) {
      const content = ["[spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a label line a setext underline breaks', () => {
    // One or two `-` under the title line is an h2 underline and `=` an h1 one — the paragraph the
    // open title belongs to turns into a heading, so the definition fails and the label line
    // never becomes a carried definition. Reading the underline as title text spanned the
    // definition across lines the parser had already given to the heading.
    const forms = ['-', '--', '- ', '==']
    for (const form of forms) {
      const content = ["[spec]: /url 'the long", form, 'tail of title', '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('does not repeat a block a quote marker closes the footnote definition at', () => {
    // A quote marker at three columns or less ends the footnote and opens a block quote of its
    // own. Reading it as footnote content printed the quote once per chunk.
    const content = ['[^n]: note', '  > quoted', '', 'tail', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('> quoted'))).toHaveLength(1)
  })

  it('does not carry a label line a quote marker breaks', () => {
    // A block quote interrupts a paragraph, so the open title ends at the marker and the
    // definition fails. Reading the marker as title text would span the definition across a line
    // the parser had already opened a quote on.
    const content = ["[spec]: /url 'the long", '> quoted tail', '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('carries a definition across an indented quote line that stays title text', () => {
    // A quote marker needs three columns or less of indent — at four the line is indented code,
    // which interrupts nothing, so the title runs on to its closing quote. Stripping any leading
    // run of spaces before the marker read the line as a quote and dropped the definition.
    const content = ["[spec]: /url 'the long", '    > quoted tail', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
  })

  it('carries a definition across a fence-shaped line whose info holds a backtick', () => {
    // A backtick fence's info string may not hold a backtick, so ```x`y opens no fence — the
    // parser reads it as prose and the title runs on to its closing quote. Matching the opening
    // run alone truncated the definition to the line before it.
    const content = ["[spec]: /url 'the long", '```x`y marks', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
  })

  it('carries footnote prose an indented setext underline stays inside the footnote as', () => {
    // An underline cannot pair with a paragraph held by another container, so `==` under the
    // footnote line stays footnote prose. Reading it as a block of its own dropped the line —
    // and every line the footnote still held — from all later chunks.
    const content = ['[^n]: note', ' ==', '', 'tail', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes(' =='))).toHaveLength(chunks.length)
  })

  it('does not carry footnote content an indented empty item closes the footnote at', () => {
    // The footnote's own continuation check has no interrupt rule, so even a marker with nothing
    // after it opens a list and closes the footnote. Reading it as footnote prose carried the
    // line into every chunk.
    const forms = [' 1.', ' -']
    for (const form of forms) {
      const content = ['[^n]: note', form, '', 'tail', '', 'see [^n]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes(form))).toHaveLength(1)
    }
  })

  it('carries a quote-held definition across a lazy setext underline', () => {
    // A line without the quote marker continues the open title only lazily, and a setext underline
    // cannot pair with a paragraph it did not see open, so the parser keeps it as title text at any
    // indent. Reading it as an underline dropped the definition from every later chunk.
    const forms = ['--', '   --', '==']
    for (const form of forms) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a quote-held definition an empty item lazily opens a list at', () => {
    // The lazy line is checked against none of the interrupt rules, so even an item with nothing
    // after its marker opens a list there and the open title ends before it closes. Reading the
    // empty marker as title text carried a definition the parser never made into every chunk.
    const forms = ['1. ', '1.', '*  ']
    for (const form of forms) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a definition a quote holds a list inside of across the quote it keeps up', () => {
    // The line's `>` continues the quote the definition was written behind; the list item inside
    // that quote is what the line skips, and it skips it lazily — a lazy line starts nothing, so
    // the title runs on. Measuring the quote against the item the definition sits in (the last
    // marker, wherever it sits) killed these the parser keeps.
    const forms = [
      ["> - [spec]: /url 'the long", "> tail of title'"],
      ["> - > [spec]: /url 'the long", ">   > tail of title'"],
      ["- > - [spec]: /url 'the long", "  > tail of title'"]
    ]
    for (const [label, tail] of forms) {
      const content = [label, tail, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a definition whose continuation quote falls out of the item holding it', () => {
    // A quote one column left of the item the definition's k-th quote sits in has fallen out of
    // that item and opens a quote of its own, ending the open title before it closes.
    const forms = [
      ["- > [spec]: /url 'the long", "> tail of title'"],
      ["- - > [spec]: /url 'the long", "  > tail of title'"],
      ["> - > [spec]: /url 'the long", "> > tail of title'"]
    ]
    for (const [label, tail] of forms) {
      const content = [label, tail, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a definition nested in quotes alone across a shallower continuation marker', () => {
    // Quotes nested in quotes alone continue wherever the marker chain allows — each marker within
    // three columns of the one it follows, which the match itself enforces. Only a quote a list
    // item holds sets a floor; measuring every quote by the container's own column killed these.
    const forms = [
      [">  > [spec]: /url 'the long", "> > tail of title'"],
      [">   > [spec]: /url 'the long", "> > tail of title'"],
      [">\t> [spec]: /url 'the long", "> > tail of title'"],
      [" > > [spec]: /url 'the long", "> > tail of title'"]
    ]
    for (const [label, tail] of forms) {
      const content = [label, tail, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a definition whose continuation opens a sibling block outside the item', () => {
    // The line reproduces the quote but not the indent the item's content starts at, so it stands
    // at the quote's own level: any list marker there — an ordered one whatever its number, which
    // the paragraph interrupt rule would have spared — opens a block that closes the item.
    const forms = [
      ["> - [spec]: /url 'the long", "> 2. tail of title'"],
      ["> - [spec]: /url 'the long", "> 3. tail of title'"],
      ["> 1. [spec]: /url 'the long", "> 2) tail of title'"],
      ["> - [spec]: /url 'the long", '> <a b=c>']
    ]
    for (const [label, tail] of forms) {
      const content = [label, tail, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a definition across a lazy setext line outside the item holding it', () => {
    // An underline cannot pair with a paragraph another container holds, and a line that starts
    // nothing continues the item's paragraph lazily, so the underline is title text.
    const forms = [
      ["> - [spec]: /url 'the long", '> ==='],
      ["> 1. [spec]: /url 'the long", '> ===']
    ]
    for (const [label, mid] of forms) {
      const content = [label, mid, "> tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a definition whose continuation quote only a tab-indented line reaches', () => {
    // The tab expands to the item's content column, so the marker it precedes continues the quote
    // after all, and the underline behind it pairs with the title — a spaces-only reading of the
    // indent took the line for lazy prose the title swallowed.
    const content = ["- > [spec]: /url 'the long", '\t> ===', "  > tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    // At the document level the same tab is four columns of indent, not a marker, and the line
    // stays the lazy prose the title takes in.
    const quoted = ["> [spec]: /url 'the long", '\t> ===', "> tail of title'", '', 'see [spec]'].join('\n')
    const quotedChunks = chunksOf(quoted, 1)
    expect(quotedChunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(
      quotedChunks.length
    )
  })

  it('does not carry a definition whose label or destination the parser would refuse', () => {
    // A label with an unescaped opening bracket cannot close, one of whitespace alone is empty,
    // a destination starting with `<` belongs to the angle brackets it never closed, and a bare
    // one carries its parentheses only in balance.
    const forms = ['[a[b]: /url', '[ ]: /url', '[spec]: <foo', '[spec]: foo(bar', '[spec]: foo(bar)x)y']
    for (const form of forms) {
      const content = [form, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes(form))).toHaveLength(1)
    }
    // A destination line that is present yet carries no destination condemns the definition too.
    const destless = ['[spec]:', "'title only'", '', 'see [spec]'].join('\n')
    expect(chunksOf(destless, 1).filter((chunk) => chunk.text.includes('[spec]:'))).toHaveLength(1)
    // What the parser accepts still rides along: an escaped bracket, balanced parens, a `<` mid
    // run, and an angle-bracketed destination with room for a space.
    const carried = ['[a\\]b]: /url', '[spec]: foo(bar)baz', '[spec]: foo<bar', '[spec]: <foo bar>']
    for (const form of carried) {
      const content = [form, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes(form))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a definition whose colon leaves its closing bracket', () => {
    // The parser reads the colon only directly behind the `]`, so `[label] : /wrong` is the prose
    // it looks like — hoisted, it stood in front of the genuine definition and won the label. The
    // wrapped label a line below closes owes its colon the same adjacency.
    const content = ['[label] : /wrong', '', '[label]: /right', '', 'see [label]'].join('\n')

    expect(resolvedReferenceUrls(content)).toEqual(['/right', '/right'])

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((chunk) => resolvedReferenceUrls(chunk.text))).toEqual(['/right', '/right'])

    const wrapped = ['[a', 'b] : /wrong', '', '[a]: /right', '', 'see [a]'].join('\n')

    expect(resolvedReferenceUrls(wrapped)).toEqual(['/right'])
    expect(chunksOf(wrapped, 1).flatMap((chunk) => resolvedReferenceUrls(chunk.text))).toEqual(['/right'])
  })

  it('does not carry a definition whose marker sits five columns behind another marker', () => {
    // The parser reads a marker plus up to four columns of separator as that marker; a fifth
    // column — of whitespace between two markers, tabs expanding as the parser counts them —
    // makes the second marker indented code the first container never sees. Carrying these
    // hoisted a definition no document had.
    const forms = ['-     - [spec]: /url', '>     - [spec]: /url', '> \t\t\t - [spec]: /url', '-\t  - [spec]: /url']
    for (const form of forms) {
      const content = [form, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes('[spec]: /url'))).toHaveLength(1)
    }
    // Four columns or less is the parser's own nesting, and the definition still rides along.
    const nested = ['-    - [spec]: /url', '-\t- [spec]: /url', '>    - [spec]: /url']
    for (const form of nested) {
      const content = [form, '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes('[spec]: /url'))).toHaveLength(chunks.length)
    }
  })

  it('carries a title line the tokenizer would not read as a tag', () => {
    // An attribute name has to start the way the tokenizer reads one — a letter, `_` or `:`,
    // never a digit or a dot, and `!` is not part of a name at all — and a closing tag takes
    // neither attributes nor a self-closing slash. None of these open a block on the lazy line,
    // so the title they sit in runs on to the line that closes it.
    const forms = ['<a 1>', '<a .b>', '<a 1b=2>', '</a x>', '</a/>', '<a b!>']
    for (const form of forms) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
    // Names the tokenizer does read, with values or not, still open a block there.
    const tags = ['<a _x=y-z>', '<a b=c>']
    for (const form of tags) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('does not carry a quote-held definition an ordered marker of any number lazily opens a list at', () => {
    // `2.` cannot interrupt a paragraph written in the document, but a lazy line takes any number,
    // so the list opens and the title that never closes leaves a plain paragraph behind.
    const content = ["> [spec]: /url 'the long", '2. x', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('does not carry a quote-held definition a tag lazily opens an HTML block at', () => {
    // A tag that cannot interrupt a paragraph still opens its block on a lazy line, where the
    // parser applies no interrupt rule — the open title ends at the tag and never closes, so the
    // label line stays a paragraph.
    const forms = ['<a>', '</a>', '<a/>']
    for (const form of forms) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a list-held definition across a lazy setext underline', () => {
    // An indent short of the column the definition starts at continues the title only lazily, and
    // the underline cannot pair with the paragraph, so it stays title text however shallow the
    // line sits. Reading it as an underline at the document's own three-column rule dropped the
    // definition from every later chunk.
    const forms = ['--', ' --']
    for (const form of forms) {
      const content = ["- [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a list-held definition an empty item lazily opens a list at', () => {
    // The lazy line takes an empty item as a list all the same, so the open title ends before it
    // closes and the marker line stays a plain list. Reading the empty marker as title text
    // carried a definition the parser never made into every chunk.
    const forms = ['1. ', ' 1. ']
    for (const form of forms) {
      const content = ["- [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('does not carry a list-held definition a setext underline inside the item breaks', () => {
    // The parser measures the line's blocks from the column the definition starts at, so an
    // underline indented to four or five columns — or one tab — still pairs with the open title.
    // Reading that indent as the document's own code boundary carried a definition the parser had
    // turned into a heading.
    const forms = ['    --', '     --', '\t--']
    for (const form of forms) {
      const content = ["- [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a list-held definition across an underline the item reads as code', () => {
    // Four columns past the one the definition starts at is indented code inside the item, which
    // interrupts nothing, so the underline stays title text.
    const forms = ['      --', '\t\t--']
    for (const form of forms) {
      const content = ["- [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('carries a definition nested behind a list and a quote across a lazy underline', () => {
    // The line reproduces neither the item's marker nor the quote's, so it continues the open
    // title only lazily and the underline stays title text.
    const content = ["- > [spec]: /url 'the long", '     --', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
  })

  it('does not carry a nested definition a quote fallen out of the item opens at', () => {
    // A quote one column short of the item's content column has left it, so the quote that opens
    // there ends the open title before it closes.
    const content = ["- > [spec]: /url 'the long", ' > --', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('carries a definition nested in a list inside a list across a lazy underline', () => {
    // The inner item's content starts four columns in, so an underline short of that column
    // continues the open title only lazily and stays title text.
    const forms = ['  --', '   --']
    for (const form of forms) {
      const content = ["- - [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('does not carry a definition nested in a list inside a list an underline inside it breaks', () => {
    // Four columns in — where the inner item's content starts — the underline pairs with the open
    // title and turns it into a heading, at relative columns a document-level rule would read as
    // code.
    const content = ["- - [spec]: /url 'the long", '    --', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('carries a definition whose lazy line holds an unfinished tag', () => {
    // A lazy line takes a tag only in its complete form, alone on the line: the tokenizer holds
    // `<a` at the line's end — a tag with content after it, and an attribute that starts the way
    // `<a b"c">` never does — to the title's paragraph, so killing the definition there dropped it
    // from every chunk that referenced it.
    for (const form of ['<a', '<a ', '<a> x', '<a b"c">']) {
      const content = ["> [spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('ends a lazily continued definition at a complete tag on a line of its own', () => {
    // A guard for the forms above: the interrupt-free lazy rule still opens a block at `<a>`.
    const content = ["> [spec]: /url 'the long", '<a>', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it("measures a tab-expanded marker's content column in columns", () => {
    // `-\t` spans four columns, so a two- or three-column underline falls short of the item's
    // content — a lazy line the setext guard holds to the title. Counting characters read the
    // two-character marker as content column two and killed the definition at `  --`.
    for (const form of ['  --', '   --']) {
      const content = ["-\t[spec]: /url 'the long", form, "tail of title'", '', 'see [spec]'].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
    }
  })

  it('pairs a setext underline through a tab that starts at the content column', () => {
    // In `- [spec]` + `  \t--` the tab expands from the very column the item measures its blocks
    // from, and its two columns of width are a relative indent of two: the underline pairs, the
    // title turns, and the definition dies. Leaving the tab unread as indent kept it alive in
    // every chunk.
    const content = ["- [spec]: /url 'the long", '  \t--', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it("holds a nested container's quote to the inner item's content column", () => {
    // `- - > ` holds the definition in the inner item, whose content starts at column four — a
    // quote marker at two or three columns falls out of that item and ends the definition, while
    // one at four continues it. The first marker's column let the shallow quotes through.
    const dead = ["- - > [spec]: /url 'the long", "  > tail of title'", '', 'see [spec]'].join('\n')

    expect(chunksOf(dead, 1).filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)

    const held = ["- - > [spec]: /url 'the long", "    > tail of title'", '', 'see [spec]'].join('\n')
    const heldChunks = chunksOf(held, 1)

    expect(heldChunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(heldChunks.length)
  })

  it('does not carry a definition behind a marker indented by a tab', () => {
    // A tab before the marker is four columns of indent — indented code, where no definition
    // opens. Reading it as a container carried one whose hoisted prefix rendered as a heading at
    // the top of every chunk.
    const content = ["\t- [spec]: /url 'the long", '--', "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('does not carry a definition whose label sits five columns past its marker', () => {
    // Five columns of whitespace leave the label in indented code — `-\t\t` spans seven and
    // `-     ` five behind a bullet, `>     ` five behind a quote — so the parser opens no
    // definition there at all.
    for (const marker of ['-\t\t', '-     ', '>     ']) {
      const content = [`${marker}[spec]: /url 'the long`, "tail of title'", '', 'see [spec]'].join('\n')

      expect(chunksOf(content, 1).filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
    }
  })

  it('carries a definition four columns behind its marker', () => {
    // A guard for the five-column rule: four columns are still the item's own paragraph.
    const content = ["-    [spec]: /url 'the long", "tail of title'", '', 'see [spec]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)
  })

  it('measures a tab in a marker’s separator from the marker’s own column', () => {
    // A guard for the tab arithmetic: a tab spans to the next stop past the marker, so `-\t ` is
    // four columns and `-\t  ` five — one stays the item’s own paragraph, the other is code.
    const carried = ["-\t [spec]: /url 'the long", "tail of title'", '', 'see [spec]'].join('\n')
    const chunks = chunksOf(carried, 1)

    expect(chunks.filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(chunks.length)

    const coded = ["-\t  [spec]: /url 'the long", "tail of title'", '', 'see [spec]'].join('\n')

    expect(chunksOf(coded, 1).filter((chunk) => chunk.text.includes("[spec]: /url 'the long"))).toHaveLength(1)
  })

  it('does not open a raw region at a self-closing raw-name tag', () => {
    // `<pre/>` is a type-7 tag, not raw HTML, so it opens no region — the footnote below it stays
    // a footnote with an html child, and the document still splits. Reading it as raw held every
    // line after it in one unsplittable chunk.
    const content = ['[^1]: note', ' <pre/>', 'tail', '', 'see [^1]'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.filter((chunk) => chunk.text.includes('[^1]: note'))).toHaveLength(chunks.length)
  })
})

describe('the window a split reports', () => {
  // The line walk already has every line's length, so the long-line verdict costs no second pass.
  it('reports a document too dominated by long lines to window', () => {
    expect(splitMarkdownChunks(`${'a'.repeat(6_000)}\n`).longLines).toBe(true)
  })

  it('reports ordinary prose as windowable', () => {
    expect(splitMarkdownChunks('# Title\n\nA short paragraph.\n').longLines).toBe(false)
  })

  it('counts a CRLF terminator as a separator rather than as content', () => {
    expect(splitMarkdownChunks(`${'a'.repeat(5_000)}\r\n`).longLines).toBe(false)
    expect(splitMarkdownChunks(`${'a'.repeat(5_001)}\r\n`).longLines).toBe(true)
  })
})

describe('hasOversizedMarkdownChunk', () => {
  it('flags one indivisible block that would still reach the renderer whole', () => {
    const chunks = chunksOf(`# head\n\n${'a'.repeat(MARKDOWN_MAX_BLOCK_CHARS + 1)}`)

    expect(hasOversizedMarkdownChunk(chunks)).toBe(true)
  })

  it('does not flag a long document made of many small blocks', () => {
    const chunks = chunksOf('para\n\n'.repeat(100_000))

    expect(hasOversizedMarkdownChunk(chunks)).toBe(false)
  })
})

describe('definitions behind legal indentation', () => {
  // CommonMark accepts a definition at up to three columns of indent; only a fourth is indented
  // code. Refusing the legal ones left the definition out of the chunks that reference it, so the
  // reference degraded to literal text while the unsplit document rendered a link.
  for (const indent of [' ', '  ', '   ']) {
    it(`carries a definition indented ${indent.length} space${indent.length > 1 ? 's' : ''}`, () => {
      const content = [
        `${indent}[label]: https://example.com/target`,
        '',
        'filler paragraph that spends the budget',
        '',
        'see [label]'
      ].join('\n')

      const chunks = chunksOf(content, 1)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.text).toContain('[label]: https://example.com/target')
      }
    })
  }

  it('leaves a four-column indented definition in the indented code it belongs to', () => {
    const content = ['    [label]: https://example.com/code', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [label]'))

    expect(referencing).toHaveLength(1)
    expect(referencing[0].text).not.toContain('[label]: https://example.com/code')
  })

  it('leaves a tab-indented definition in the indented code it belongs to', () => {
    const content = ['\t[label]: https://example.com/code', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [label]'))

    expect(referencing).toHaveLength(1)
    expect(referencing[0].text).not.toContain('[label]: https://example.com/code')
  })
})

describe('definitions inside blocks the parser reads as raw', () => {
  // First definition wins, so carrying a definition-looking line out of the raw block it lives in
  // would redirect every reference to the wrong destination — even in a single chunk.
  it('does not carry a definition-looking line out of a quoted fenced block', () => {
    const content = [
      '> ```',
      '> [label]: https://example.com/wrong',
      '> ```',
      '',
      'see [label]',
      '',
      '[label]: https://example.com/correct'
    ].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: https://example.com/correct\n\n')).toBe(true)
  })

  it('does not carry a definition-looking line out of a block-level HTML block', () => {
    const content = [
      '<div>',
      '[label]: https://example.com/wrong',
      '</div>',
      '',
      'see [label]',
      '',
      '[label]: https://example.com/correct'
    ].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: https://example.com/correct\n\n')).toBe(true)
  })

  it('collects a definition the quote below an unterminated quoted fence opens', () => {
    // A line without the markers ends the quote and its fence; the parser reads what follows at
    // the top level, so the suppression must not outlive the fence.
    const content = ['> ```', 'plain line', '', '[label]: https://example.com/target', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })

  it('collects a definition after the blank line that ends an HTML block', () => {
    const content = ['<div>', '</div>', '', '[label]: https://example.com/target', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })

  it('collects a definition an unquoted line writes below a quoted HTML block', () => {
    // `> <div>` opens the HTML block inside the quote, and the unquoted line below it closes the
    // block: the parser takes the definition at the top level and resolves `see [label]` to it.
    // Holding the block open to the blank line swallowed the definition and left the reference
    // literal in every chunk but the one that holds it.
    const content = [
      '> <div>',
      '[label]: https://example.com/target',
      '',
      ...Array.from({ length: 6 }, (_, index) => ['', `para ${index}`]).flat(),
      '',
      'see [label]'
    ].join('\n')

    expect(parsed('> <div>\n[label]: https://example.com/target').children[1].type).toBe('definition')

    const chunks = chunksOf(content, 40)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })

  it('collects a definition an unquoted line writes below a quoted raw HTML block', () => {
    // `> <script>` opens a raw block the quote holds, and the unquoted line below it leaves both:
    // the parser takes the definition at the top level. Held open to its closing tag, the block
    // swallowed the definition and left `see [label]` literal in every chunk but the first.
    const content = [
      '> <script>',
      '[label]: https://example.com/target',
      '</script>',
      '',
      ...Array.from({ length: 6 }, (_, index) => ['', `para ${index}`]).flat(),
      '',
      'see [label]'
    ].join('\n')

    expect(parsed('> <script>\n[label]: https://example.com/target').children[1].type).toBe('definition')

    const chunks = chunksOf(content, 40)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com/target')
    }
  })
})

describe('document-wide heading slugs', () => {
  // Each chunk renders as its own document, so duplicate headings in separate chunks would collide
  // on one slug where the unsplit document numbers the second `-1` — and `[second](#title-1)` then
  // finds no target even with both chunks mounted.
  it('numbers duplicate headings across chunks the way the unsplit document would', () => {
    const content = ['# Title', '', 'one', '', '# Title', '', 'two'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title'])
    expect(chunks[2].headingSlugs?.get('title')).toEqual(['title-1'])
  })

  it('counts a heading behind quote markers toward the document-wide numbering', () => {
    const content = ['# Title', '', '> # Title', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title'])
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title-1'])
    expect(chunks[2].headingSlugs?.get('title')).toEqual(['title-2'])
  })

  it('counts a heading a raw HTML block renders toward the document-wide numbering', () => {
    // The block renders an `<h2>` element, so the unsplit document numbers it between the two
    // Markdown headings — the ids, and the `#fragment` links aimed at them, must survive the split.
    const content = ['# Title', '', '<h2>Title</h2>', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunkHeadingIds(content, 1)).toEqual(['chunk--title', 'chunk--title-2'])
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title-1'])
    expect(chunks[2].headingSlugs?.get('title')).toEqual(['title-2'])
  })

  it('numbers two headings a raw HTML block renders on one line in document order', () => {
    // Both headings share the line they render on, so the line holds both assignments in order —
    // keeping only the last reversed the ids, and `[jump](#title)` aimed at the second heading.
    const content = ['<h2>Title</h2><h2>Title</h2>', '', '[jump](#title)'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title', 'title-1'])
  })

  it('counts a raw HTML heading whose tag and text sit on different lines', () => {
    // `<h2>` opens the block and its text and closing tag sit below; the heading renders all the
    // same, so the document numbers it and the `# Title` after it takes `-1`.
    const content = ['<h2>', 'Title', '</h2>', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title'])
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title-1'])
    expect(chunkHeadingIds(content, 1)).toEqual(['chunk--title-1'])
  })

  it('counts a raw HTML heading the document ends inside', () => {
    // No blank line closes the block, so the scan runs at the end of the document rather than at
    // the blank — the heading still counts, and a duplicate below another chunk keys off it.
    const content = ['filler paragraph that spends the budget', '', '<h2>', 'Title', '</h2>'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.at(-1)?.headingSlugs?.get('title')).toEqual(['title'])
  })

  it('does not count a heading a raw comment only mentions', () => {
    const content = ['<!-- <h2>Title</h2> -->', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title'])
  })

  it('does not count a heading inside a fenced code block', () => {
    const content = ['```', '# Title', '```', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs).toBeUndefined()
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title'])
  })
})

describe('a definition shape that is paragraph text', () => {
  // A link definition cannot interrupt a paragraph, so the shape is prose wherever a paragraph is
  // still open — and first-definition precedence means carrying it would redirect every reference.
  it('does not carry a definition shape a container marker only continues', () => {
    // `> [label]: /wrong` repeats the marker of the paragraph above it rather than opening a block,
    // so it is one quoted paragraph; micromark renders `[label]: /wrong` as text and `see [label]`
    // as a link to `/right`.
    const content = ['> paragraph', '> [label]: /wrong', '', '[label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    // The carried prefix is what every chunk renders ahead of its own lines, so it holds the
    // definition the document's references resolve to — and no other.
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[label]: /right\n\n')).toBe(true)
    }
  })

  it('carries a definition a deeper quote marker does open', () => {
    const content = ['> paragraph', '> > [label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: /right')
    }
  })

  it('carries a definition a list marker opens even inside a quote', () => {
    // `- [label]: /right` opens a fresh item, which ends the paragraph above it.
    const content = ['> - item', '> - [label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: /right')
    }
  })

  it('carries the definition below a completed heading', () => {
    // `# heading` is a leaf block complete where it stands, so the line under it opens freely.
    const content = ['# heading', '[label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: /right')
    }
  })

  it('carries the definition below a heading that follows a long stretch of paragraphs', () => {
    const content = [
      ...Array<string>(30).fill('x'.repeat(1000)).join('\n\n').split('\n'),
      '',
      '# heading',
      '[label]: /right',
      '',
      'see [label]'
    ].join('\n')

    const chunks = chunksOf(content, 24)

    expect(chunks.length).toBeGreaterThan(1)
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [label]'))
    expect(referencing).toHaveLength(1)
    // The heading is complete where it stands, so the definition below it is carried into a chunk
    // that does not hold the line it was written on.
    expect(referencing[0].text.startsWith('[label]: /right\n\n')).toBe(true)
  })

  it('carries the definition below a setext heading', () => {
    const content = ['Title', '=====', '[label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: /right')
    }
  })

  it('carries the definition below a heading written as a bare hash', () => {
    // A lone `#` is the empty ATX heading the parser reads, so the line under it opens fresh —
    // holding paragraph state open kept the definition out, and the reference degraded to text.
    const content = '#\n[label]: /right\n\n' + 'filler\n\n'.repeat(3071) + 'see [label]'

    const chunks = chunksOf(content)

    expect(chunks.length).toBeGreaterThan(1)
    const last = chunks[chunks.length - 1]
    expect(last.text).toContain('see [label]')
    expect(resolvedReferenceUrls(last.text)).toEqual(['/right'])
  })
})

describe('a definition shape inside a fence a container holds', () => {
  it('does not carry a definition out of a fence opened behind a list marker', () => {
    // `- ``` ` opens a fence the item holds; micromark renders the definition line as code and
    // `see [label]` as a link to `/right`.
    const content = ['- ```', '', '  [label]: /wrong', '  ```', '', '[label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[label]: /right\n\n')).toBe(true)
    }
  })

  it('does not carry a definition out of a fence opened behind a nested list marker', () => {
    const content = ['> - ```', '>', '>   [label]: /wrong', '>   ```', '', '[label]: /right', '', 'see [label]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[label]: /right\n\n')).toBe(true)
    }
  })

  it('does not treat the closing fence of a list-held fence as an opening one', () => {
    // The closing ``` behind a list marker used to open a fence that swallowed the real definition.
    const content = ['- ```', '  code', '  ```', '', '[label]: /right', '', 'see [label]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[label]: /right\n\n')).toBe(true)
    }
  })
})

describe('a footnote definition behind a container', () => {
  it('does not start a footnote definition inside indented code', () => {
    // Five spaces past the marker leave the label in indented code; micromark shows `right`.
    const content = ['-     [^n]: wrong', '', 'see [^n]', '', '[^n]: right'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[^n]: right\n\n')).toBe(true)
    }
  })

  it('starts a footnote definition a list marker legally holds', () => {
    const content = ['- [^n]: right', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^n]: right')
    }
  })

  it('holds a quoted continuation to four columns past the container', () => {
    // `>  second` carries two columns inside the quote, so it is an ordinary quoted paragraph
    // rather than a continuation: micromark renders it as a blockquote paragraph of its own.
    const content = ['> [^n]: first', '>', '>  second', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    // The definition and the blank marker line it spans, and nothing past that blank.
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('[^n]: first\n\n\n')).toBe(true)
    }
  })

  it('carries a quoted continuation that reaches four columns past the container', () => {
    const content = ['> [^n]: first', '>', '>     second', '', 'see [^n]'].join('\n')

    const chunks = chunksOf(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('second')
    }
  })
})

describe('document-wide heading slugs across heading syntaxes', () => {
  // The slug a heading renders comes from the text the renderer parses, so the scan has to read
  // setext headings and strip containers the same way — or a setext `Title` and an ATX `Title` are
  // counted once between them and both render `title`, leaving `#title-1` with no target.
  it('numbers a setext heading and an ATX heading of the same text separately', () => {
    const content = ['Title', '=====', '', '# Title', '', '[jump](#title-1)'].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title', 'title-1'])
  })

  it('numbers a heading behind a list marker toward the same base', () => {
    const content = ['- # Title', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title'])
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title-1'])
  })

  it('numbers a setext heading behind quote markers toward the same base', () => {
    const content = ['> Title', '> =====', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs?.get('title')).toEqual(['title'])
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title-1'])
  })

  it('counts a setext heading whose underline is three dashes', () => {
    // `---` is an h2 underline at any length from one dash up; only three or more `*` or `_` is
    // a thematic break instead. The underline regex admitted one or two dashes, so `Title` was
    // never recorded and the ATX heading below took `title` — leaving `#title-1` with no target
    // even with both chunks mounted.
    const filler = 'filler\n\n'.repeat(3200)
    const content = `Title\n---\n${filler}# Title\n\n[jump](#title-1)\n`

    expect(parsed('Title\n---').children[0].type).toBe('heading')

    const chunks = chunksOf(content)

    expect(chunks.filter((chunk) => chunk.headingSlugs)).toHaveLength(2)
    expect(renderedHeadingIds(content)).toEqual(['chunk--title', 'chunk--title-1'])
    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
  })

  it('resolves a link to a duplicate heading written as a setext underline', () => {
    // The target a `#fragment` navigation looks for is the rendered id, so the ATX `Title` has to
    // render `title-1` for the link to find it — which only holds while the underline above it is
    // counted as the heading it is.
    const filler = 'filler\n\n'.repeat(3200)
    const content = `Title\n---\n${filler}# Title\n\nsee [jump](#doc--title-1)\n`

    expect(headingIds(content)).toEqual(['doc--title', 'doc--title-1'])
    expect(chunkedHeadingIds(content)).toContain('doc--title-1')
  })

  it('does not count a setext underline that is a thematic break', () => {
    // Three `*` is a thematic break whether or not a paragraph sits above it, and a break is
    // not a heading — so neither line here may be recorded as one.
    const content = ['Title', '***', '', '# Title', ''].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks[0].headingSlugs).toBeUndefined()
    expect(chunks[1].headingSlugs?.get('title')).toEqual(['title'])
  })
})

describe('a title left open across a long document', () => {
  it('reads each line below an unterminated title once', () => {
    // An unterminated title once rescanned and rebuilt the accumulated title for every line below
    // it, which blocked preview preparation on a few hundred kilobytes of ordinary text. The
    // unterminated title is a paragraph, so exactly one chunk — the one it was written in — holds it.
    const content = ['[spec]: /url "the long', ...Array<string>(32_000).fill('ordinary text')].join('\n')

    const window = splitMarkdownChunks(content)

    expect(window.longLines).toBe(false)
    // A blank line would end the title's paragraph and with it the scan, so the input holds none
    // and the document is one chunk; the unterminated title itself renders in that chunk alone.
    expect(window.chunks).toHaveLength(1)
    expect(window.chunks.filter((chunk) => chunk.text.includes('[spec]: /url'))).toHaveLength(1)
  })

  it('drops the whole tentative title when one starting below the destination fails', () => {
    // The parser accepts the destination-only definition (`{url: '/right', title: null}`), so a
    // title opened a line below it either closes or leaves no trace. Rewinding only the line where
    // the attempt died left the earlier rejected title lines in the definition, and the copy the
    // splitter hoists into the later chunk emitted them a second time — an extra paragraph the
    // parser never produces.
    const content = ['[label]: /right', '"never closed', 'second line', '', 'see [label]'].join('\n')

    expect(hoistedDefinition(content)).toBe('[label]: /right')
  })

  it('emits one copy of a definition whose failing title spans several lines', () => {
    // The rewind has to cover every line the attempt consumed, not just the last one.
    const content = ['[spec]: /url', '"the long', 'and longer', 'and longest', '', 'text'].join('\n')

    expect(hoistedDefinition(content)).toBe('[spec]: /url')
  })
})

describe('heading ids assigned from the text the renderer reads', () => {
  // The slug a heading renders comes from its parsed text, so a heading written as a link renders
  // its label and numbers toward the same base as the plain heading it reads as.
  it('numbers a linked heading toward the base its label renders', () => {
    // Both headings render `Title`, so the document ids are `title` and `title-1` and
    // `[jump](#title-1)` finds its target — reading the raw source put the second on another base.
    const content = ['# Title', '', '# [Title](https://example.com)', '', '[jump](#title-1)'].join('\n')

    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--title', 'chunk--title-1'])
  })

  it('keeps an unresolved reference in the text a heading renders', () => {
    // A reference the document never defines renders as literal text, so `# [Alpha][r] Beta` slugs
    // on `alphar-beta` and the plain `# Alpha Beta` below it takes `alpha-beta` — the id
    // `[jump](#alpha-beta)` resolves. Stripping the reference syntax keyed the first heading on
    // `alpha-beta` as well, so the duplicate was numbered `alpha-beta-1` and the link beside it
    // aimed at a fragment no chunk mounted.
    const content = '# [Alpha][r] Beta\n\n' + 'filler\n\n'.repeat(3100) + '# Alpha Beta\n\n[jump](#alpha-beta)'

    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--alphar-beta', 'chunk--alpha-beta'])
  })

  it('strips a reference the document does define', () => {
    // The same shape with `[r]` defined is a real link, so both headings read `Alpha Beta` and the
    // second takes the `-1` — the guard must not turn a resolved reference into literal text.
    const content =
      '[r]: /url\n\n# [Alpha][r] Beta\n\n' + 'filler\n\n'.repeat(3100) + '# Alpha Beta\n\n[jump](#alpha-beta-1)'

    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--alpha-beta', 'chunk--alpha-beta-1'])
  })

  it('numbers a struck-through heading toward the text the renderer reads', () => {
    // The renderer reads `~~bar~~` as the `del` it renders — no text of its own — so both headings
    // read `foobarbaz` and the second takes the `-1` the link beside it points at. Counting the
    // first under its literal tildes left the second as plain `foobarbaz` too, and the two ids
    // collided.
    const content = '# foo~~bar~~baz\n\n' + 'filler\n\n'.repeat(3100) + '# foobarbaz\n\n[jump](#foobarbaz-1)'

    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--foobarbaz', 'chunk--foobarbaz-1'])
  })

  it('numbers a highlighted heading toward the text the renderer reads', () => {
    // The renderer reads `==bar==` as the `mark` it renders — `foo<mark>bar</mark>baz`, whose text
    // is `foobarbaz` — so both headings read `foobarbaz` and the second takes the `-1` the link
    // beside it points at. Counting the first under its literal `==` markers keyed it `foo-bar-baz`
    // and left the duplicate unsuffixed, so `[jump](#foobarbaz-1)` aimed at a fragment that no
    // chunk mounted. The markers are asserted here rather than through `renderedHeadingIds`, whose
    // parser runs without the highlight extension.
    const content = '# foo==bar==baz\n\n' + 'filler\n\n'.repeat(3100) + '# foobarbaz\n\n[jump](#foobarbaz-1)'

    const chunks = chunksOf(content)
    expect(chunks.filter((chunk) => chunk.headingSlugs)).toHaveLength(2)
    // Both chunks key the heading on `foobarbaz`; it is the second one's assignment that carries
    // the `-1` the link resolves, which is what counting the markers as text took away.
    expect(chunks.flatMap((chunk) => [...(chunk.headingSlugs?.values() ?? [])].flat())).toEqual([
      'foobarbaz',
      'foobarbaz-1'
    ])
  })

  it('keeps the backslash a heading renders before a non-punctuation character', () => {
    // Markdown preserves a backslash before anything but ASCII punctuation, so `C:\Users` renders
    // with the backslash and slugs as `c-users-alice`. Dropping every backslash keyed the first
    // heading `cusersalice`, the duplicate below went unsuffixed, and the link beside it aimed at
    // a fragment no chunk mounted.
    const filler = ['', 'x'.repeat(64), '']
    const content = ['# C:\\Users\\Alice', ...filler, '# C-Users-Alice', '', '[jump](#c-users-alice-1)'].join('\n')

    expect(chunkHeadingIds(content, 1)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--c-users-alice', 'chunk--c-users-alice-1'])
  })

  it('numbers headings a setext paragraph spans by the whole paragraph', () => {
    // The renderer reads the heading as the paragraph's text `a\nb`, one `a-b` base with `# a-b`.
    const content = ['a', 'b', '===', '', '# a-b', ''].join('\n')

    expect(chunkHeadingIds(content)).toEqual(renderedHeadingIds(content))
    expect(renderedHeadingIds(content)).toEqual(['chunk--a-b', 'chunk--a-b-1'])
  })

  it('does not count a heading a type-7 HTML block swallows', () => {
    // `<span>` opens a type-7 block whose lines the parser reads as raw text; a phantom heading
    // between two real ones would hand the last its `-2` id where the document gives `-1`.
    const filler = ['', 'x'.repeat(64), '']
    const content = ['# Title', ...filler, '<span>', '# Title', '</span>', ...filler, '# Title'].join('\n')

    expect(chunkHeadingIds(content, 1)).toEqual(renderedHeadingIds(content))
  })

  it('does not count a heading a fence behind a quote and a list marker holds', () => {
    const filler = ['', 'x'.repeat(64), '']
    const content = ['# Title', ...filler, '> - ```', '>   # Title', '>   ```', ...filler, '# Title'].join('\n')

    expect(chunkHeadingIds(content, 1)).toEqual(renderedHeadingIds(content))
  })
})

describe('a list whose fence holds its items together', () => {
  it('keeps a list whose item opens a fenced block in one chunk', () => {
    // micromark numbers the two items 1 and 2 of one list; cut apart at the blank line behind the
    // fence, each piece renders a one-item list that starts over at 1.
    const content = ['1. ```', ...Array<string>(64).fill('   code'), '   ```', '', '1. next'].join('\n')

    expect(chunksOf(content, 1).flatMap((chunk) => renderedListNumbers(chunk.text))).toEqual([1, 2])
    expect(chunksOf(content, 1)).toHaveLength(1)
  })
})

describe('a definition shape inside a fence a mixed container holds', () => {
  it('does not carry a footnote definition out of a fence opened behind a quote and a list marker', () => {
    // `> - ``` ` opens a fence the item holds; micromark renders `[^n]: wrong` as code inside it and
    // shows `right`, so the code-only label must not reach the carried prefix ahead of the real one.
    const content = ['> - ```', '>   [^n]: wrong', '>   ```', '', 'see [^n]', '', '[^n]: right'].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[^n]: right\n\n')).toBe(true)
  })

  it('does not carry a definition-looking line out of a quote and a list marker either', () => {
    const content = ['> - ```', '>   [label]: /wrong', '>   ```', '', 'see [label]', '', '[label]: /right'].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: /right\n\n')).toBe(true)
  })
})

describe('a definition shape the parser reads in columns', () => {
  it('leaves a tab-indented footnote definition in the indented code it belongs to', () => {
    // A tab spans four columns, so the label sits in indented code — micromark shows `right`.
    // Carrying the code line put `code-only` on every chunk and shadowed the real footnote.
    const content = ['\t[^n]: code-only', '', 'see [^n]', '', '[^n]: right'].join('\n')

    const chunks = chunksOf(content, 1)
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [^n]'))

    expect(referencing).toHaveLength(1)
    expect(referencing[0].text).not.toContain('code-only')
    expect(referencing[0].text.startsWith('[^n]: right\n\n')).toBe(true)
  })
})

describe('a definition shape inside a type-7 HTML block', () => {
  it('does not carry a definition-looking line out of a type-7 HTML block', () => {
    // `<span>` alone on its line opens a type-7 block that runs to the blank line, so the label
    // inside it is raw text; micromark resolves `see [label]` to `/right`.
    const content = [
      '<span>',
      '# ignored',
      '[label]: /wrong',
      '</span>',
      '',
      '[label]: /right',
      '',
      'see [label]'
    ].join('\n')

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: /right\n\n')).toBe(true)
  })

  it('leaves a type-7 tag under an open paragraph as paragraph text', () => {
    // A type-7 block cannot interrupt a paragraph, so the shape stays prose and no block opens.
    const content = ['para', '<span>', '[label]: /wrong', '</span>', '', '[label]: /right', '', 'see [label]'].join(
      '\n'
    )

    const chunks = chunksOf(content)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.startsWith('[label]: /right\n\n')).toBe(true)
    expect(chunks[0].text.split('\n\n')[0]).not.toContain('/wrong')
  })
})

describe('a malformed tag that never closes', () => {
  // The tag walk restarted one character past an unterminated `<` and rescanned the whole suffix
  // behind it, so a line of `<a` repeated cost its length squared: the synchronous splitter took
  // seconds on a document well inside the preview's read ceiling, and the long-line fallback that
  // would have guarded it is only chosen after this work finishes.
  it('reads each unterminated tag once instead of rescanning the suffix behind it', () => {
    const content = `<div>\n${'<a'.repeat(65_536)}\n\n</div>\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    // The `<div>` element never closes, so no boundary may fall and the document stays whole.
    expect(window.chunks).toHaveLength(1)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('keeps reading tags after an unterminated one on the same block', () => {
    // The unterminated `<a` is dropped, but the `</div>` behind it still has to close the element
    // the block opened — a walk that gave up at the first failure would leave `div` on the open
    // stack and hold every later boundary off, so the document would never window at all.
    const content = ['<div>', '<a', 'text', '</div>', '', 'para one', '', 'para two'].join('\n')

    const chunks = chunksOf(content, 20)

    expect(chunks.length).toBeGreaterThan(1)
    expect(joined(chunks)).toContain('para two')
  })

  it('tracks a stack of open elements without rescanning it per tag', () => {
    // Every ordinary opening tag asked whether the stack already held `svg` or `math`, so the
    // question was answered against a stack the line was still growing: 64K openers on one line
    // cost their count squared, and the splitter stalled before the fallback could guard it.
    const content = `<div>\n${'<p>x\n'.repeat(64_000)}</p>\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1_000)
  })
})

/**
 * The ids a source's headings render with — the target a `#fragment` link resolves against. Chunks
 * are read with the slugs the splitter assigned, so the whole path from source to rendered id is
 * under test, and the unsplit document is the oracle: its ids are the ones the user asked for.
 */
const headingIds = (source: string, slugs?: ReadonlyMap<string, readonly string[]>): string[] => {
  const root = {
    type: 'root',
    children: parsed(source)
      .children.filter((node) => node.type === 'heading')
      .map((node) => ({
        type: 'element',
        tagName: `h${(node as unknown as { depth: number }).depth}`,
        properties: {} as { id?: unknown },
        children: node.children
      }))
  }
  rehypeHeadingIds({ prefix: 'doc', slugs })(root as never)
  return root.children.map((element) => String((element as { properties: { id?: unknown } }).properties.id))
}

/** The ids every chunk of a document renders, in document order. */
const chunkedHeadingIds = (content: string, budgetChars?: number): string[] =>
  chunksOf(content, budgetChars).flatMap((chunk) => headingIds(chunk.text, chunk.headingSlugs))

describe('a heading an inline construct only partly renders', () => {
  it('bases a heading id on the text the renderer reads, not its source', () => {
    // micromark reads `*bar*` as emphasis, so the heading renders `Foobar` and the unsplit document
    // numbers it `foobar-1` on the same base. The scanner kept the markers and keyed it `foo-bar`,
    // so both headings rendered `--foobar` and the link lost its target across the boundary.
    const filler = ['', 'x'.repeat(400)]
    const content = ['# Foo*bar*', ...filler, '# Foobar', '', 'see [second](#doc--foobar-1)'].join('\n')

    // The two headings have to land in different chunks: a chunk that holds both carries both
    // assignments and renders the right ids even while the scan keys the first on the wrong base.
    const chunks = chunksOf(content, 5)
    const headings = chunks.filter((chunk) => chunk.headingSlugs)

    expect(headings).toHaveLength(2)
    expect(chunkedHeadingIds(content, 5)).toEqual(headingIds(content))
    expect(headingIds(content)).toEqual(['doc--foobar', 'doc--foobar-1'])
  })
})

describe('a definition beside indented code', () => {
  it('carries a definition that indented code does not absorb', () => {
    // micromark opens indented code at `    code` and reads `[label]: /right` as the document's
    // definition, so the chunk that says `see [label]` renders a link. The scanner treated the code
    // as an open paragraph, suppressed the definition, and rendered the reference literally.
    const paragraphs = Array.from({ length: 4 }, (_, index) => `para ${index}`)
    const content = ['    code', '[label]: /right', '', ...paragraphs.join('\n\n').split('\n'), '', 'see [label]'].join(
      '\n'
    )

    const chunks = chunksOf(content, 40)
    const referencing = chunks.filter((chunk) => chunk.text.includes('see [label]'))

    expect(chunks.length).toBeGreaterThan(1)
    expect(referencing).toHaveLength(1)
    expect(referencing[0].text.startsWith('[label]: /right\n\n')).toBe(true)
  })
})

describe('a heading whose source the parser cannot close', () => {
  it('does not rescan an unmatched bracket run once per character', () => {
    // Each failure rescanned the rest of the line while the outer walk advanced one character, so
    // the scan cost the run's length squared: a 64K-bracket heading blocked the renderer seconds,
    // on a file well inside the preview's size ceiling and one the plain-text fallback never sees.
    const content = `# ${'['.repeat(65_536)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('scans a nested label only as far as the budget allows', () => {
    // The budget was charged only when a label was read, so a heading whose nested labels are all
    // rejected still rescanned every one of them: each rejection advanced the outer walk by a single
    // character while rescanning the whole remaining suffix, and the cost grew with the square of
    // the run. The line is deliberately sized so the total stays inside the 64K budget — a larger
    // input trips the budget on the first label and never reaches this path at all.
    const run = 32_000
    const content = `# ${'['.repeat(run)}x](y)${']'.repeat(run - 1)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(window.longLines).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('reads a label whose destination never closes without rescanning what follows it', () => {
    // Every `](` here opens a destination the rest of the segment never closes, so each candidate
    // rescanned everything left in the segment and 16K of them took seconds. The count is chosen
    // so the label stays inside the 64K budget: past it the run is given up on at the first label,
    // and a shape that overshoots never reaches the scan being bounded here at all.
    const pairs = 16_000
    const content = `# ${'['.repeat(pairs)}${']('.repeat(pairs)}${']'.repeat(pairs)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(window.longLines).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('consumes a reference the document never defines instead of rewinding to its start', () => {
    // `[a][b` closes the label but leaves the reference open, so `follow` is -1 and the walk was
    // sent back to index -1 — the next step restarted the segment from 0 and every one of the 1,000
    // headings paid the whole line again. The label budget never charged a run that was given up on,
    // so neither fallback guard fired and the whole split stalled before the preview could render.
    const headings = 1_000
    const content = `${'# [a][b\n'.repeat(headings)}`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1_000)
  })
})

/** The destination a source's first definition with `label` gives it — CommonMark's own order. */
const referenceTarget = (source: string, label = 'label'): string | null => {
  let found: string | null = null
  const visit = (node: { type: string; identifier?: string; url?: string; children?: unknown[] }): void => {
    if (found !== null) return
    if (node.type === 'definition' && node.identifier === label) {
      found = node.url ?? null
      return
    }
    for (const child of node.children ?? []) visit(child as never)
  }
  visit(parsed(source))
  return found
}

/** Whether a source's definitions sit inside a fenced code block, where the parser reads none. */
const definitionInsideCode = (source: string, destination: string): boolean => {
  let inside = false
  const visit = (node: { type: string; value?: string; children?: unknown[] }): void => {
    if (node.type === 'code' && String(node.value).includes(destination)) inside = true
    for (const child of node.children ?? []) visit(child as never)
  }
  visit(parsed(source))
  return inside
}

describe('a fenced code block a list and a quote both hold', () => {
  // `- > ``` ` opens the fence inside a quote inside an item. The chain has to be read in the order
  // it was written: the item's content column and the quote markers its continuation lines carry
  // differ from `> - ``` `, where the quote comes first.
  const chains: Array<[string, string]> = [
    ['- > ```', '  > '],
    ['> - ```', '    '],
    ['- > > ```', '      '],
    ['> - > ```', '    '],
    ['> > ```', '    '],
    ['- - ```', '    '],
    ['- > - ```', '  >   ']
  ]

  for (const [opener, continuation] of chains) {
    it(`keeps the definition inside the fence ${JSON.stringify(opener)} opens`, () => {
      const content = [
        opener,
        `${continuation}# h`,
        `${continuation}[label]: /wrong`,
        `${continuation}\`\`\``,
        '',
        '[label]: /right',
        '',
        '[label]'
      ].join('\n')

      // The fence owns the definition line, so the document's own definition is the one below it.
      expect(definitionInsideCode(content, '/wrong')).toBe(true)
      expect(referenceTarget(content)).toBe('/right')

      const transformed = chunksOf(content)
        .map((chunk) => chunk.text)
        .join('\n')

      expect(referenceTarget(transformed)).toBe('/right')
      // The carried prefix is what hoists the wrong definition to the front of every chunk; the
      // fence itself stays in the chunk it was written in and still shows the line verbatim.
      expect(chunksOf(content).some((chunk) => chunk.text.startsWith('[label]: /wrong'))).toBe(false)
    })
  }
})

describe('a heading whose label nests another link', () => {
  it('reads the label the way the renderer does when a link sits inside it', () => {
    // A link may not hold a link, so the inner one wins and the outer brackets stay literal text:
    // the renderer's heading text is `[a b d](e)`, not `a b d`. Both headings key on the same base
    // either way here, so the assertion is on the text the chunks hand to the renderer.
    const content = ['# [a [b](c) d](e)', '', '# [a b d](e)'].join('\n')

    expect(chunkedHeadingIds(content, 1)).toEqual(headingIds(content))
    expect(headingIds(content)).toHaveLength(2)
  })

  it('reads a link label before the text that follows it', () => {
    // The label was queued while the scan read on, so the text after the link was appended before
    // the label's own text: `# [Alpha](url) Beta` keyed on the base `beta-alpha` while the renderer
    // reads `Alpha Beta`, and the two headings collided on an id neither of them carried.
    const content = `# [Alpha](url) Beta\n${'filler\n\n'.repeat(3200)}# Alpha Beta\n`
    const chunks = chunksOf(content)

    expect(chunks.filter((chunk) => chunk.headingSlugs)).toHaveLength(2)
    expect(chunkedHeadingIds(content)).toEqual(headingIds(content))
    expect(headingIds(content)).toEqual(['doc--alpha-beta', 'doc--alpha-beta-1'])
  })

  it('resolves a link to a heading whose text a link label and a suffix both render', () => {
    // The consumer is the rendered id, not the slug map: both headings normalize to `alpha-beta`,
    // so the second has to render `alpha-beta-1` for `[jump](#alpha-beta-1)` to have a target.
    const filler = 'filler\n\n'.repeat(3200)
    const content = `# [Alpha](url) Beta\n${filler}# Alpha Beta\n\nsee [jump](#doc--alpha-beta-1)\n`

    expect(headingIds(content)).toEqual(['doc--alpha-beta', 'doc--alpha-beta-1'])
    expect(chunkedHeadingIds(content)).toContain('doc--alpha-beta-1')
  })

  it('stops reading labels once their nesting passes the budget', () => {
    // A label nested in another costs a scan of the label it sits in, so a heading whose labels
    // nest 64K deep cost the scan its length squared — 14 seconds on the renderer main thread, on
    // a line well past the long-line budget but read before the fallback is decided. Past the
    // budget the run is read as the text it was written as, which is what the renderer prints.
    const content = `# ${'['.repeat(65_536)}x](y)${']'.repeat(65_535)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(window.longLines).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('keeps a heading of unclosed destinations inside the budget', () => {
    // Every `[` re-read the destination run behind it, and a run that never closes reads to the end
    // of the line, so a heading of `[a](` repeated cost its length squared — 4.8 seconds at 32K, on
    // a line already past the long-line budget but read before the fallback is decided.
    const content = `# ${'[a]('.repeat(32_768)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(window.longLines).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('does not exhaust the call stack on a deeply nested bracket run', () => {
    // Each label used to be read by a recursive call, so a heading whose label nests another label
    // thousands deep exhausted the stack. The line is far past the long-line budget, but the split
    // runs before the fallback is decided, so the throw reached the user instead of the source view.
    const content = `# ${'['.repeat(20_000)}x${']'.repeat(20_000)}\n`

    const started = Date.now()
    const window = splitMarkdownChunks(content)
    const elapsed = Date.now() - started

    expect(window.chunks).toHaveLength(1)
    expect(window.longLines).toBe(true)
    expect(elapsed).toBeLessThan(1_000)
  })
})

describe('a heading whose text a character reference spells', () => {
  it('bases a heading id on the text the renderer decodes the reference to', () => {
    // The renderer decodes `&copy;` to `©`, so `# A&copy;B` and `# A©B` are the same heading text and
    // the unsplit document numbers the second `-1`. The scanner kept a table of six entities and
    // read the rest as literal text, so the two keyed on different bases and `#a-b-1` had no target
    // in either chunk.
    const filler = `${'filler\n\n'.repeat(3200)}`
    const content = `# A&copy;B\n${filler}# A©B\n`
    const chunks = chunksOf(content)

    // The two headings have to land in different chunks: a chunk holding both carries both
    // assignments and renders the right ids even while the scan keys the first on the wrong base.
    expect(chunks.filter((chunk) => chunk.headingSlugs)).toHaveLength(2)
    expect(chunkedHeadingIds(content)).toEqual(headingIds(content))
    expect(headingIds(content)).toEqual(['doc--a-b', 'doc--a-b-1'])
  })

  it('leaves a reference the renderer refuses as the literal text it was written as', () => {
    // The renderer reads `&bogus;` as text, so the heading's id keeps the name spelled out.
    const content = ['# A&bogus;B', '', '# A&B'].join('\n')

    expect(chunkedHeadingIds(content, 1)).toEqual(headingIds(content))
  })
})

describe('a document written with bare CR line endings', () => {
  it('counts a bare CR as a line terminator, as the parser does', () => {
    // CommonMark ends a line at a bare CR. Splitting on `\n` alone left the whole document as one
    // line, so its 5,999 characters read as a single long line and the preview dropped to source
    // mode with the preview switch locked.
    const content = Array(600).fill('# Heading').join('\r')
    const window = splitMarkdownChunks(content)

    expect(window.longLines).toBe(false)
    expect(window.chunks).toHaveLength(1)
  })

  it('measures the same document the same way whichever terminator it uses', () => {
    const body = Array(600).fill('# Heading').join('|')
    for (const terminator of ['\n', '\r\n', '\r']) {
      expect(splitMarkdownChunks(body.replace(/\|/g, terminator)).longLines).toBe(false)
    }
  })
})
