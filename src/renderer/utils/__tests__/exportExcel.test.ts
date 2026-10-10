import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportTableToExcel } from '../exportExcel'

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
  save: vi.fn()
}

describe('exportTableToExcel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (xlsxMock.worksheet as Record<string, unknown>)['!cols']
    xlsxMock.write.mockReturnValue([1, 2, 3])
    fileApiMock.save.mockResolvedValue('/tmp/cherry-export/custom-table.xlsx')

    Object.assign(window, {
      api: {
        ...window.api,
        file: {
          ...window.api?.file,
          save: fileApiMock.save
        }
      }
    })
  })

  it('should export parsed table rows through @e965/xlsx', async () => {
    const result = await exportTableToExcel([
      ['Name', 'Age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])

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
    expect(fileApiMock.save).toHaveBeenCalledWith('table_2026-06-01_010203.xlsx', new Uint8Array([1, 2, 3]), {
      filters: [{ name: expect.any(String), extensions: ['xlsx'] }]
    })
  })
})
