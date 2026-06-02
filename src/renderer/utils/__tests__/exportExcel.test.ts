import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportTableToExcel, parseMarkdownTable } from '../exportExcel'

const excelJsMock = vi.hoisted(() => {
  const worksheet = {
    addRows: vi.fn(),
    columns: undefined as { width: number }[] | undefined
  }
  const writeBuffer = vi.fn()
  const addWorksheet = vi.fn(() => worksheet)
  const Workbook = vi.fn(() => ({
    addWorksheet,
    xlsx: {
      writeBuffer
    }
  }))

  return {
    addWorksheet,
    Workbook,
    worksheet,
    writeBuffer
  }
})

vi.mock('exceljs', () => ({
  default: {
    Workbook: excelJsMock.Workbook
  }
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
    excelJsMock.worksheet.columns = undefined
    excelJsMock.writeBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
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

  it('should export parsed table rows through ExcelJS', async () => {
    const markdown = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`

    const result = await exportTableToExcel(markdown)

    expect(result).toBe(true)
    expect(excelJsMock.Workbook).toHaveBeenCalledTimes(1)
    expect(excelJsMock.addWorksheet).toHaveBeenCalledWith('Sheet1')
    expect(excelJsMock.worksheet.addRows).toHaveBeenCalledWith([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])
    expect(excelJsMock.worksheet.columns).toEqual([{ width: 10 }, { width: 10 }])
    expect(excelJsMock.writeBuffer).toHaveBeenCalledTimes(1)
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
