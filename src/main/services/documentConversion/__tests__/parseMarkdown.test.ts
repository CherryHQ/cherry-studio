import { describe, expect, it } from 'vitest'

import { DocumentConversionError } from '../DocumentConversionError'
import { parseMarkdown } from '../parseMarkdown'

describe('PDF-generated inline HTML', () => {
  it('turns anydoc underline markup into a plain underlined heading', () => {
    const [heading] = parseMarkdown('# <u>Card source 15659</u>', true, { interpretSafeHtml: true })
    expect(heading).toMatchObject({
      type: 'heading',
      text: 'Card source 15659',
      runs: [{ text: 'Card source 15659', underline: true }]
    })
    expect(JSON.stringify(heading)).not.toContain('<u>')
  })

  it('keeps literal angle brackets in user Markdown', () => {
    const [heading] = parseMarkdown('# <u>Card source 15659</u>')
    expect(heading).toMatchObject({ type: 'heading', text: '<u>Card source 15659</u>' })
    const [prose] = parseMarkdown('Compare a < b and keep <not-a-tag> prose.')
    expect(prose).toMatchObject({ type: 'text', text: 'Compare a < b and keep <not-a-tag> prose.' })
  })
})

describe('nested container tables', () => {
  const rows = [
    ['A', 'B'],
    ['1', '2']
  ]

  it('accepts a table under every quote and list nesting order', () => {
    const sources = [
      '- > | A | B |\n  > | --- | --- |\n  > | 1 | 2 |',
      '> - | A | B |\n>   | --- | --- |\n>   | 1 | 2 |',
      '> - > | A | B |\n>   > | --- | --- |\n>   > | 1 | 2 |',
      '1. > | A | B |\n   > | --- | --- |\n   > | 1 | 2 |',
      '- - | A | B |\n    | --- | --- |\n    | 1 | 2 |',
      '> > 1. | A | B |\n> >    | --- | --- |\n> >    | 1 | 2 |'
    ]
    for (const markdown of sources) {
      expect(parseMarkdown(markdown).find((block) => block.type === 'table')).toMatchObject({ type: 'table', rows })
    }
  })

  it('keeps escaped pipes and pipes inside code spans in the cell that owns them', () => {
    const [table] = parseMarkdown('| A \\| B | `x\\|y` |\n| --- | --- |\n| 1 | 2 |')
    expect(table).toMatchObject({
      type: 'table',
      rows: [
        ['A | B', 'x|y'],
        ['1', '2']
      ]
    })
  })

  it('rejects a nested table row with an extra or missing cell', () => {
    const extra = '- > | A | B |\n  > | --- | --- |\n  > | 1 | 2 | 3 |'
    const missing = '> - | A | B |\n>   | --- | --- |\n>   | 1 |'
    for (const markdown of [
      extra,
      missing,
      '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
      '| A | B |\n| --- | --- |\n| 1 |'
    ]) {
      expect(() => parseMarkdown(markdown)).toThrow(DocumentConversionError)
      try {
        parseMarkdown(markdown)
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_TABLE' })
      }
    }
  })
})

describe('document image URLs', () => {
  it('keeps dangerous URL schemes out of image blocks when enabling file URLs', () => {
    for (const source of ['javascript:alert%281%29', 'vbscript:msgbox%281%29', 'data:text/html;base64,PHNjcmlwdD4=']) {
      const blocks = parseMarkdown(`![Image](${source})`)
      expect(blocks.some((block) => block.type === 'image')).toBe(false)
    }
  })
})
