import { describe, expect, it } from 'vitest'

import { hasOversizedMarkdownChunk, MARKDOWN_MAX_BLOCK_CHARS, splitMarkdownChunks } from '../markdownChunks'

const joined = (chunks: Array<{ text: string }>) => chunks.map((chunk) => chunk.text).join('\n')

describe('splitMarkdownChunks', () => {
  it('keeps a document that has no definitions lossless across its chunks', () => {
    const content = ['para one', '', 'para two', '', 'para three'].join('\n')

    expect(joined(splitMarkdownChunks(content, 10))).toBe(content)
  })

  it('splits at blank lines once the chunk budget is spent', () => {
    const content = ['para one', '', 'para two', '', 'para three'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks.length).toBeGreaterThan(1)
    expect(joined(chunks)).toBe(content)
  })

  it('keeps a fenced code block that spans blank lines in one chunk', () => {
    // A boundary inside the fence would tear the code block in half and leave both chunks malformed.
    const content = ['opening paragraph', '', '```', 'code line', '', 'more code', '```', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('code line\n\nmore code')
  })

  it('keeps display math that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '$$', 'x = 1', '', 'y = 2', '$$', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('keeps dollar display math that opens with content on its line in one chunk', () => {
    const content = ['opening paragraph', '', '$$x = 1234567890', '', 'y = 2$$', '', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(3)
    expect(chunks[1].text).toContain('$$x = 1234567890\n\ny = 2$$')
  })

  it('keeps dollar display math built around a LaTeX environment in one chunk', () => {
    const content = ['opening paragraph', '', '$$\\begin{align}', 'x = 1', '', 'y = 2', '\\end{align}$$', ''].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('does not treat inline dollar math as a block a boundary could fall inside', () => {
    // `$$x = 1$$` closes on its own line, so the parser leaves it to the inline tokenizer.
    const content = ['opening paragraph', '', '$$x = 1$$ and text', '', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(3)
  })

  it('keeps the tail of a document in one chunk while its dollar math is unclosed', () => {
    // The parser reads an unclosed `$$` as math to the end of the document, so the splitter follows it.
    const content = ['opening paragraph', '', '$$x = 1', '', 'y = 2', '', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('y = 2\n\nafter')
  })

  it('keeps a raw HTML block that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '<pre>', 'raw one', '', 'raw two', '</pre>', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('raw one\n\nraw two')
  })

  it('does not end a chunk on a blank line that an indented continuation follows', () => {
    // That blank line is part of the block above it — a footnote definition or indented code block.
    const content = ['opening paragraph', '', '    indented body', '', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks[0].text).toContain('indented body')
  })

  it('does not end a chunk inside a run of blank lines that indented code spans', () => {
    // One indented code block: only the last blank line before unindented text ends it.
    const content = ['opening paragraph', '', '    code one', '', '', '    code two', '', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toContain('code one\n\n\n    code two')
  })

  it('keeps an ordered list whose numbering a boundary would reset in one chunk', () => {
    // The list numbers its items from its first marker, so `1. 1. 1.` renders 1, 2, 3 as one list
    // and 1, 1, 1 as three documents.
    const content = ['1. first', '', '1. second', '', '1. third'].join('\n')

    expect(splitMarkdownChunks(content, 1)).toHaveLength(1)
  })

  it('keeps the rest of an ordered list together once its numbering stops matching', () => {
    const content = ['1. first', '', '1. second', '', '2. third'].join('\n')

    expect(splitMarkdownChunks(content, 1)).toHaveLength(1)
  })

  it('keeps an ordered list whose markers skip numbers in one chunk', () => {
    // `1. 3. 5.` renders 1, 2, 3 as one list, so the written numbers cannot carry across a boundary.
    const content = ['1. first', '', '3. second', '', '5. third'].join('\n')

    expect(splitMarkdownChunks(content, 1)).toHaveLength(1)
  })

  it('still windows an ordered list whose markers name the numbers it renders', () => {
    const content = ['1. first', '', '2. second', '', '3. third'].join('\n')

    expect(splitMarkdownChunks(content, 1)).toHaveLength(3)
  })

  it('still windows the ordered lists of a document where a heading ends the first one', () => {
    const content = ['1. first', '', '1. second', '', '# heading', '', '1. third', '', '2. fourth'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks).toHaveLength(4)
    expect(chunks[0].text).toContain('1. first\n\n1. second')
    expect(chunks[3].text).toContain('2. fourth')
  })

  it('carries a link reference definition into the chunk that uses it', () => {
    // A chunk is its own document, so a reference whose definition lives elsewhere renders literally.
    const content = ['[label]: https://example.com', '', 'see [label]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[label]: https://example.com')
    }
  })

  it('carries a footnote definition into the chunk that uses it', () => {
    const content = ['[^1]: the note', '', 'see the note[^1]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: the note')
    }
  })

  it('carries a definition with an indented continuation line', () => {
    const content = ['[^1]: first line', '    second line', '', 'see [^1]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: first line\n    second line')
    }
  })

  it('does not carry visible text that shares a block with a definition', () => {
    // Only definitions render nothing everywhere else; hoisting the paragraph would duplicate it.
    const content = ['[label]: https://example.com', 'visible tail text', '', 'see [label]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('visible tail text'))).toHaveLength(1)
  })

  it('splits every chunk at the budget rather than every paragraph after the first', () => {
    // Without a reset, the budget stops being spent once and every later paragraph becomes a chunk.
    const content = Array.from({ length: 10 }, (_, i) => `paragraph-${i + 1}`).join('\n\n')

    const chunks = splitMarkdownChunks(content, 60)

    expect(chunks).toHaveLength(2)
  })

  it('keeps bracket display math that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '\\[', 'x = 1', '', 'y = 2', '\\]', 'after'].join('\n')

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('keeps a LaTeX environment that spans blank lines in one chunk', () => {
    const content = ['opening paragraph', '', '\\begin{align}', 'x = 1', '', 'y = 2', '\\end{align}', 'after'].join(
      '\n'
    )

    const chunks = splitMarkdownChunks(content, 10)

    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toContain('x = 1\n\ny = 2')
  })

  it('carries a multi-paragraph footnote definition in full', () => {
    const content = ['[^1]: first paragraph', '', '    second paragraph', '', 'see [^1]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    for (const chunk of chunks) {
      expect(chunk.text).toContain('[^1]: first paragraph\n\n    second paragraph')
    }
  })

  it('does not carry a code block that only follows a link definition', () => {
    // A footnote definition owns its indented lines; a link definition ends with its line run.
    const content = ['[label]: https://example.com', '', '    indented body', '', 'see [label]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('indented body'))).toHaveLength(1)
  })

  it('does not carry definition syntax found inside a fenced code block', () => {
    const content = ['```', '[label]: https://example.com', '```', '', 'see [label]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('https://example.com'))).toHaveLength(1)
  })
})

describe('hasOversizedMarkdownChunk', () => {
  it('flags one indivisible block that would still reach the renderer whole', () => {
    const chunks = splitMarkdownChunks(`# head\n\n${'a'.repeat(MARKDOWN_MAX_BLOCK_CHARS + 1)}`)

    expect(hasOversizedMarkdownChunk(chunks)).toBe(true)
  })

  it('does not flag a long document made of many small blocks', () => {
    const chunks = splitMarkdownChunks('para\n\n'.repeat(100_000))

    expect(hasOversizedMarkdownChunk(chunks)).toBe(false)
  })
})
