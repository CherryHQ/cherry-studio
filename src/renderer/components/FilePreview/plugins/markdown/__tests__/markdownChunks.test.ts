import { describe, expect, it } from 'vitest'

import { hasOversizedMarkdownBlock, MARKDOWN_MAX_BLOCK_CHARS, splitMarkdownChunks } from '../markdownChunks'

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

  it('does not carry definition syntax found inside a fenced code block', () => {
    const content = ['```', '[label]: https://example.com', '```', '', 'see [label]'].join('\n')

    const chunks = splitMarkdownChunks(content, 1)

    expect(chunks.filter((chunk) => chunk.text.includes('https://example.com'))).toHaveLength(1)
  })
})

describe('hasOversizedMarkdownBlock', () => {
  it('flags one indivisible block that would still reach the renderer whole', () => {
    expect(hasOversizedMarkdownBlock(`# head\n\n${'a'.repeat(MARKDOWN_MAX_BLOCK_CHARS + 1)}`)).toBe(true)
  })

  it('does not flag a long document made of many small blocks', () => {
    expect(hasOversizedMarkdownBlock('para\n\n'.repeat(100_000))).toBe(false)
  })
})
