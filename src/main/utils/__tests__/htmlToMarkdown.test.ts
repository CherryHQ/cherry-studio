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

  it('holds the column open for every remaining row when the rowspan is 0', () => {
    // rowspan="0" covers the rest of the row group. Read as a single row, "2 m" moved into the
    // Product column and the last two rows lost a cell at their end.
    const markdown = convert(
      '<table><thead><tr><th>Product</th><th>Variant</th><th>Price</th></tr></thead>' +
        '<tbody><tr><td rowspan="0">Cable</td><td>1 m</td><td>9 EUR</td></tr>' +
        '<tr><td>2 m</td><td>12 EUR</td></tr>' +
        '<tr><td>3 m</td><td>15 EUR</td></tr></tbody></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['Product', 'Variant', 'Price'],
      ['---', '---', '---'],
      ['Cable', '1 m', '9 EUR'],
      ['', '2 m', '12 EUR'],
      ['', '3 m', '15 EUR']
    ])
  })

  it('stops a rowspan of 0 at the end of its row group', () => {
    const markdown = convert(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
        '<tbody><tr><td rowspan="0">x</td><td>1</td></tr><tr><td>2</td></tr></tbody>' +
        '<tfoot><tr><td>f1</td><td>f2</td></tr></tfoot></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['A', 'B'],
      ['---', '---'],
      ['x', '1'],
      ['', '2'],
      ['f1', 'f2']
    ])
  })

  it('reads a colspan of 0 as one column', () => {
    // HTML dropped colspan="0", and a browser reports colSpan === 1 for it.
    const markdown = convert('<table><tr><th>A</th><th>B</th></tr><tr><td colspan="0">x</td><td>1</td></tr></table>')

    expect(tableRows(markdown)).toEqual([
      ['A', 'B'],
      ['---', '---'],
      ['x', '1']
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

  it('writes a header row and its body with no blank line between them', () => {
    const markdown = convert(
      '<table><thead><tr><th>Plan</th><th>Price</th></tr></thead>' +
        '<tbody><tr><td>Starter</td><td>9 EUR</td></tr><tr><td>Pro</td><td>29 EUR</td></tr></tbody></table>'
    )

    expect(markdown).toBe('| Plan | Price |\n| --- | --- |\n| Starter | 9 EUR |\n| Pro | 29 EUR |')
  })

  it("holds a rowspan open when it covers the row's last columns", () => {
    // No later cell forces the placeholder, so it has to come from the row's right-side padding.
    const markdown = convert(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td rowspan="2">x</td></tr><tr><td>2</td></tr></table>'
    )

    expect(tableRows(markdown)).toEqual([
      ['A', 'B'],
      ['---', '---'],
      ['1', 'x'],
      ['2', '']
    ])
  })

  it('does not let a span attribute grow the output', () => {
    // colspan="1000000" produced ten million characters from a few bytes of page.
    const page = (span: number) => `<table><tr><td colspan="${span}">x</td></tr><tr><td>a</td></tr></table><p>after</p>`
    const huge = convert(page(1_000_000))

    expect(huge).toBe(convert(page(1000)))
    expect(huge.length).toBeLessThan(100)
    expect(huge).toContain('after')
  })

  it('survives spans that would cover millions of grid cells', () => {
    // Tracking that many slots threw "RangeError: Set maximum size exceeded".
    const html = `<table>${'<tr><td rowspan="65534" colspan="1000">x</td></tr>'.repeat(3)}</table>`

    expect(() => convert(html)).not.toThrow()
  })

  it('keeps the widest row inside the table when the spans are over budget', () => {
    // Past the budget the delimiter counted only the header's own cells, so the third cell of the
    // last row fell outside the table.
    const html =
      '<table><tr><th>A</th><th>B</th></tr>' +
      '<tr><td colspan="1000">wide</td></tr>' +
      '<tr><td>1</td><td>2</td><td>3</td></tr></table>'

    expect(convert(html)).toBe('| A | B | |\n| --- | --- | --- |\n| wide |\n| 1 | 2 | 3 |')
  })

  it('pads only the header when padding every row would outgrow the budget', () => {
    // GFM fills a short body row with empty cells itself. Padding every row instead grows with the
    // square of the table: one wide row under many narrow ones.
    const width = 2000
    const html = '<table>' + '<tr><td>h</td></tr>'.repeat(width) + `<tr>${'<td>w</td>'.repeat(width)}</tr></table>`

    const markdown = convert(html)
    const lines = markdown.split('\n')

    expect(lines[1]).toBe(`|${' --- |'.repeat(width)}`)
    expect(lines[lines.length - 1]).toBe(`|${' w |'.repeat(width)}`)
    expect(markdown.length).toBeLessThan(40 * width)
  })

  it('keeps the table whole around a row that has no cells', () => {
    // Turndown writes a cell-less row as a blank line, which ended the table.
    const html = '<table><tr><th>A</th><th>B</th></tr><tr></tr><tr><td>1</td><td>2</td></tr></table>'

    expect(convert(html)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('puts the delimiter under the first row that has cells', () => {
    const html = '<table><tr></tr><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>'

    expect(convert(html)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('folds a long run of non-breaking spaces without backtracking', () => {
    // A `\s*\n\s*` fold took 4.7 s for 80,000 of them and grows with the square of the run.
    const html = `<table><tr><th>A</th></tr><tr><td>x${'\u00a0'.repeat(200_000)}</td></tr></table>`

    expect(tableRows(convert(html))[2]).toEqual(['x'])
  }, 5_000)

  it('keeps a pipe inside a code span from splitting the cell', () => {
    // The code span already has one backslash; a second made an even run, which GFM splits at.
    const html = '<table><tr><th>Regex</th><th>Use</th></tr><tr><td><code>a\\|b</code></td><td>alt</td></tr></table>'

    expect(convert(html).split('\n')[2]).toBe('| `a\\|b` | alt |')
  })

  it('leaves markup without a table alone', () => {
    expect(convert('<p>hello</p><ul><li>a</li></ul>')).toBe(
      new TurndownService().turndown('<p>hello</p><ul><li>a</li></ul>')
    )
  })
})
