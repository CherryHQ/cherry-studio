import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { documentBlocks, documentSource, previewSource, sourceDocument } from '../documentSource'
import { ComposerDocument, ComposerParagraph, ComposerText } from '../sourceSchema'

describe('Markdown document source', () => {
  it('preserves frontmatter, CRLF, literal variables and trailing whitespace through an unrelated edit', () => {
    const source = '\uFEFF---\r\ntitle: Draft\r\n---\r\n\r\n${name}  \r\n\r\nLast\r\n'
    const editor = new Editor({
      extensions: [ComposerDocument, ComposerParagraph, ComposerText],
      content: sourceDocument(source)
    })
    expect(documentSource(editor.state.doc)).toBe(source)
    let position = 0
    editor.state.doc.forEach((node, offset) => {
      if (node.textContent === 'Last\r') position = offset + 1
    })
    editor.view.dispatch(editor.state.tr.insertText('New ', position))
    expect(documentSource(editor.state.doc)).toBe(source.replace('Last', 'New Last'))
    editor.destroy()
  })

  it('keeps block offsets tied to the original source when hiding frontmatter and parsing rich content', () => {
    const source =
      '---\ntitle: Draft\n---\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n\\[\na +\n\nb\n\\]\n\n```mermaid\ngraph LR\nA --> B\n```\n'
    const blocks = documentBlocks(source)
    expect(blocks.map(({ from, to }) => source.slice(from, to))).toEqual([
      '| A | B |\n| - | - |\n| 1 | 2 |',
      '\\[\na +\n\nb\n\\]',
      '```mermaid\ngraph LR\nA --> B\n```'
    ])
    expect(previewSource(source).length).toBe(source.length)
  })
})
