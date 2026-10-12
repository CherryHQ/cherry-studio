// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
import { documentToMarkdown, flattenDocumentBlocks } from '../serializeDocument'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('HTML layout text extraction', () => {
  it('preserves code indentation and trailing whitespace through HTML-to-Markdown conversion', () => {
    const code = '    first()\n\t  second()  \n\n'
    document.body.innerHTML = `<pre style="white-space:pre">${code}</pre>`
    const { blocks } = extractHtmlDocument()
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source))).toMatchObject([{ type: 'code', text: code }])
  })

  it.each(['flex', 'grid'])('retains direct text around inline children in a %s container', (display) => {
    document.body.innerHTML = `<div style="display:${display}">Total: <span style="display:inline">10</span><span style="display:inline">USD</span></div>`
    const { blocks } = extractHtmlDocument()
    expect(parseMarkdown(documentToMarkdown(blocks, (source) => source))).toMatchObject([
      { type: 'text', text: 'Total: 10USD' }
    ])
  })

  it('retains direct and nested block text in source order', () => {
    document.body.innerHTML = '<div style="display:flex">Before <div>Middle</div> after <div>Last</div> end</div>'
    const { blocks } = extractHtmlDocument()
    expect(flattenDocumentBlocks(blocks).map((block) => ('text' in block ? block.text : undefined))).toEqual([
      'Before',
      'Middle',
      'after',
      'Last',
      'end'
    ])
  })

  it('keeps columns when direct text contains only layout whitespace', () => {
    document.body.innerHTML = '<div style="display:flex">\n <div>Left</div>\n <div>Right</div>\n</div>'
    expect(extractHtmlDocument().blocks).toMatchObject([
      { type: 'columns', columns: [[{ text: 'Left' }], [{ text: 'Right' }]] }
    ])
  })
})
