import { describe, expect, it } from 'vitest'

import { parseMarkdownTable } from '../exportExcel'

describe('parseMarkdownTable', () => {
  it('should parse standard markdown table', () => {
    const markdown = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])
  })

  it('should skip separator lines', () => {
    const markdown = `| A | B |
|---|---|
| 1 | 2 |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2']
    ])
  })

  it('should handle alignment markers in separator', () => {
    const markdown = `| Left | Center | Right |
|:-----|:------:|------:|
| a | b | c |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Left', 'Center', 'Right'],
      ['a', 'b', 'c']
    ])
  })

  it('should skip empty lines', () => {
    const markdown = `| A | B |
|---|---|

| 1 | 2 |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2']
    ])
  })

  it('should return empty array for invalid input', () => {
    expect(parseMarkdownTable('')).toEqual([])
    expect(parseMarkdownTable('not a table')).toEqual([])
    expect(parseMarkdownTable('just some text\nwith lines')).toEqual([])
  })

  it('should handle cells with special characters', () => {
    const markdown = `| Feature | Status |
|---------|--------|
| $100.00 | ✅ Done |
| v2.0 (beta) | ⚠️ WIP |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Feature', 'Status'],
      ['$100.00', '✅ Done'],
      ['v2.0 (beta)', '⚠️ WIP']
    ])
  })

  it('should trim whitespace from cells', () => {
    const markdown = `|  Name  |  Value  |
|--------|---------|
|  foo   |  bar    |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['Name', 'Value'],
      ['foo', 'bar']
    ])
  })

  it('should skip lines without pipe delimiters', () => {
    const markdown = `Some text before
| A | B |
|---|---|
| 1 | 2 |
Some text after`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['A', 'B'],
      ['1', '2']
    ])
  })

  it('should handle single column table', () => {
    const markdown = `| Item |
|------|
| One |
| Two |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([['Item'], ['One'], ['Two']])
  })

  it('should handle empty cells', () => {
    const markdown = `| A | B | C |
|---|---|---|
| 1 |  | 3 |`

    const result = parseMarkdownTable(markdown)

    expect(result).toEqual([
      ['A', 'B', 'C'],
      ['1', '', '3']
    ])
  })
})
