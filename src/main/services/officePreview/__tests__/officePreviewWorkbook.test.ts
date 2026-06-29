import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { convertXlsxToUniverWorkbook } from '../officePreviewWorkbook'

const mocks = vi.hoisted(() => ({
  parseOffice: vi.fn()
}))

type SheetSnapshot = {
  name: string
  cellData: Record<number, Record<number, { v: string; t: number }>>
  mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>
  rowCount: number
  columnCount: number
}

vi.mock('officeparser', () => ({
  OfficeParser: {
    parseOffice: mocks.parseOffice
  }
}))

describe('convertXlsxToUniverWorkbook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps officeparser sheet rows and cells into a Univer workbook snapshot', async () => {
    mocks.parseOffice.mockResolvedValue({
      content: [
        {
          type: 'sheet',
          metadata: { sheetName: 'Revenue' },
          children: [
            {
              type: 'row',
              children: [
                { type: 'cell', text: ' Product ', metadata: { row: 0, col: 0 } },
                { type: 'cell', text: 'Q1', metadata: { row: 0, col: 1 } }
              ]
            },
            {
              type: 'row',
              children: [{ type: 'cell', text: 'Total', metadata: { row: 1, col: 1, rowSpan: 2, colSpan: 3 } }]
            }
          ]
        }
      ]
    })

    const workbook = await convertXlsxToUniverWorkbook('/tmp/report.xlsx')
    const sheet = workbook.sheets['sheet-1'] as SheetSnapshot

    expect(mocks.parseOffice).toHaveBeenCalledWith('/tmp/report.xlsx', {
      extractAttachments: false,
      includeRawContent: false,
      ocr: false,
      fileType: 'xlsx'
    })
    expect(workbook).toMatchObject({
      id: 'office-preview-loyw3v28',
      name: 'report.xlsx',
      appVersion: '0.25.1',
      locale: 'enUS',
      sheetOrder: ['sheet-1']
    })
    expect(sheet.name).toBe('Revenue')
    expect(sheet.cellData[0][0]).toEqual({ v: 'Product', t: 1 })
    expect(sheet.cellData[0][1]).toEqual({ v: 'Q1', t: 1 })
    expect(sheet.cellData[1][1]).toEqual({ v: 'Total', t: 1 })
    expect(sheet.mergeData).toEqual([{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 4 }])
    expect(sheet.rowCount).toBeGreaterThanOrEqual(100)
    expect(sheet.columnCount).toBeGreaterThanOrEqual(20)
  })

  it('creates an empty sheet when officeparser returns no sheet nodes', async () => {
    mocks.parseOffice.mockResolvedValue({ content: [] })

    const workbook = await convertXlsxToUniverWorkbook('/tmp/empty.xlsx')
    const sheet = workbook.sheets['sheet-1'] as SheetSnapshot

    expect(workbook.sheetOrder).toEqual(['sheet-1'])
    expect(sheet.name).toBe('Sheet1')
    expect(sheet.cellData).toEqual({})
  })
})
