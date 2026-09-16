import TurndownService from 'turndown'
import { describe, expect, it } from 'vitest'

import { applyTableRules } from '../htmlToMarkdown'

const convert = (html: string) => applyTableRules(new TurndownService()).turndown(html)

/** Read the markdown table back the way a reader does. */
const tableRows = (markdown: string) =>
  markdown
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.replace(/\\(.)/g, '$1').trim())
    )

describe('applyTableRules', () => {
  it('keeps a value in the row and the column it belongs to', () => {
    // Turndown ships no table rules, so every cell came out as a paragraph of
    // its own and a price lost the product it belonged to.
    const markdown = convert(
      '<h1>Specs</h1>' +
        '<table><thead><tr><th>Product</th><th>Price</th></tr></thead>' +
        '<tbody><tr><td>Cable</td><td>9 EUR</td></tr><tr><td>Hub</td><td>29 EUR</td></tr></tbody></table>' +
        '<p>after</p>'
    )

    expect(tableRows(markdown)).toEqual([
      ['Product', 'Price'],
      ['---', '---'],
      ['Cable', '9 EUR'],
      ['Hub', '29 EUR']
    ])
    // The table has to be a block of its own, or it is read as prose.
    expect(markdown).toBe(
      'Specs\n=====\n\n| Product | Price |\n| --- | --- |\n| Cable | 9 EUR |\n| Hub | 29 EUR |\n\nafter'
    )
  })

  it('uses the first row as the header when the page wrote no th', () => {
    const markdown = convert(
      '<table><tr><td>Product</td><td>Price</td></tr><tr><td>Cable</td><td>9 EUR</td></tr></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['Product', 'Price'],
      ['---', '---'],
      ['Cable', '9 EUR']
    ])
  })

  it('keeps a pipe inside the cell that holds it', () => {
    const markdown = convert(
      '<table><tr><th>Product</th><th>Spec</th></tr><tr><td>Cable</td><td>USB-A|USB-C</td></tr></table>'
    )

    expect(tableRows(markdown)[2]).toEqual(['Cable', 'USB-A|USB-C'])
  })

  it("keeps a cell's own backslash next to a pipe", () => {
    const markdown = convert('<table><tr><th>Pattern</th></tr><tr><td>a\\|b</td></tr></table>')

    expect(tableRows(markdown)[2]).toEqual(['a\\|b'])
  })

  it('keeps the inline markup inside a cell', () => {
    const markdown = convert(
      '<table><tr><th>Item</th></tr><tr><td><b>Cable</b>, see <a href="https://example.com/docs">Docs</a></td></tr></table>'
    )

    expect(tableRows(markdown)[2]).toEqual(['**Cable**, see [Docs](https://example.com/docs)'])
  })

  it('folds a line break inside a cell into a space', () => {
    const markdown = convert('<table><tr><th>Note</th></tr><tr><td>one<br>two</td></tr></table>')

    expect(tableRows(markdown)[2]).toEqual(['one two'])
  })

  it('puts a caption in its own paragraph above the table', () => {
    const markdown = convert('<table><caption>Prices</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>')

    expect(markdown).toBe('Prices\n\n| A |\n| --- |\n| 1 |')
  })

  it('leaves markup without a table alone', () => {
    expect(convert('<p>hello</p><ul><li>a</li></ul>')).toBe(
      new TurndownService().turndown('<p>hello</p><ul><li>a</li></ul>')
    )
  })
})
