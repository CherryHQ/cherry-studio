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

  it('pads the columns a colspan covers', () => {
    // One cell for three columns left the row two cells short of the header.
    const markdown = convert(
      '<table><tr><th>A</th><th>B</th><th>C</th></tr>' +
        '<tr><td colspan="3">total</td></tr>' +
        '<tr><td>1</td><td colspan="2">rest</td></tr></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['A', 'B', 'C'],
      ['---', '---', '---'],
      ['total', '', ''],
      ['1', 'rest', '']
    ])
  })

  it('holds the column a rowspan covers open in the rows below it', () => {
    // Without the placeholder, "9 EUR" moved left into the Product column.
    const markdown = convert(
      '<table><tr><th>Product</th><th>Variant</th><th>Price</th></tr>' +
        '<tr><td rowspan="2">Cable</td><td>1 m</td><td>9 EUR</td></tr>' +
        '<tr><td>2 m</td><td>12 EUR</td></tr></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['Product', 'Variant', 'Price'],
      ['---', '---', '---'],
      ['Cable', '1 m', '9 EUR'],
      ['', '2 m', '12 EUR']
    ])
  })

  it('counts the header columns by their spans', () => {
    const markdown = convert(
      '<table><tr><th colspan="2">Size</th><th>Price</th></tr>' + '<tr><td>S</td><td>M</td><td>9 EUR</td></tr></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['Size', '', 'Price'],
      ['---', '---', '---'],
      ['S', 'M', '9 EUR']
    ])
  })

  it('pads a row that is short of the widest row', () => {
    const markdown = convert('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>')

    expect(tableRows(markdown)).toEqual([
      ['A', 'B'],
      ['---', '---'],
      ['1', '']
    ])
  })

  it('leaves markup without a table alone', () => {
    expect(convert('<p>hello</p><ul><li>a</li></ul>')).toBe(
      new TurndownService().turndown('<p>hello</p><ul><li>a</li></ul>')
    )
  })
})
