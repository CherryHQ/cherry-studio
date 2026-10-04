import { describe, expect, it } from 'vitest'

import { hasOversizedMarkdownChunk, MARKDOWN_MAX_BLOCK_CHARS, splitMarkdownChunks } from '../markdownChunks'

const joined = (chunks: Array<{ text: string }>) => chunks.map((chunk) => chunk.text).join('\n')
const chunksOf = (content: string, budgetChars?: number) => splitMarkdownChunks(content, budgetChars).chunks

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

  it('still windows between a list and the blocks around it', () => {
    const content = ['para one', '', '1. first', '1. second', '', 'para two', '', 'para three'].join('\n')

    const chunks = chunksOf(content, 1)

    expect(chunks).toHaveLength(4)
    expect(chunks[1].text).toContain('1. first\n1. second')
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
