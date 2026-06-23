import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportTableToExcel, parseMarkdownTable } from '../exportExcel'

const xlsxMock = vi.hoisted(() => {
  const worksheet = {}
  const workbook = {}
  return {
    aoaToSheet: vi.fn(() => worksheet),
    bookAppendSheet: vi.fn(),
    bookNew: vi.fn(() => workbook),
    workbook,
    worksheet,
    write: vi.fn()
  }
})

vi.mock('@e965/xlsx', () => ({
  utils: {
    aoa_to_sheet: xlsxMock.aoaToSheet,
    book_append_sheet: xlsxMock.bookAppendSheet,
    book_new: xlsxMock.bookNew
  },
  write: xlsxMock.write
}))

vi.mock('dayjs', () => ({
  default: () => ({
    format: () => '2026-06-01_010203'
  })
}))

const fileApiMock = {
  selectFolder: vi.fn(),
  write: vi.fn()
}

describe('exportTableToExcel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (xlsxMock.worksheet as Record<string, unknown>)['!cols']
    xlsxMock.write.mockReturnValue([1, 2, 3])
    fileApiMock.selectFolder.mockResolvedValue('/tmp/cherry-export')
    fileApiMock.write.mockResolvedValue(undefined)

    Object.assign(window, {
      api: {
        ...window.api,
        file: {
          ...window.api?.file,
          selectFolder: fileApiMock.selectFolder,
          write: fileApiMock.write
        }
      }
    })
  })

  it('should export parsed table rows through @e965/xlsx', async () => {
    const markdown = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`

    const result = await exportTableToExcel(markdown)

    expect(result).toBe(true)
    expect(xlsxMock.aoaToSheet).toHaveBeenCalledWith([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])
    expect(xlsxMock.worksheet).toMatchObject({
      '!cols': [{ wch: 10 }, { wch: 10 }]
    })
    expect(xlsxMock.bookNew).toHaveBeenCalledTimes(1)
    expect(xlsxMock.bookAppendSheet).toHaveBeenCalledWith(xlsxMock.workbook, xlsxMock.worksheet, 'Sheet1')
    expect(xlsxMock.write).toHaveBeenCalledWith(xlsxMock.workbook, { type: 'array', bookType: 'xlsx' })
    expect(fileApiMock.write).toHaveBeenCalledWith(
      '/tmp/cherry-export/table_2026-06-01_010203.xlsx',
      new Uint8Array([1, 2, 3])
    )
  })
})

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
