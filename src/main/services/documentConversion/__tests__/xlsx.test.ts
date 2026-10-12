// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { readWorkbook } from '@cherrystudio/spreadsheet'

import { extractHtmlDocument } from '../htmlDocument'
import { convertXlsx } from '../xlsx'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('HTML tables exported to XLSX', () => {
  it.each(['<table></table>', '<table><tr></tr></table>'])(
    'uses the text worksheet when the table has no cells: %s',
    async (table) => {
      document.body.innerHTML = `<p>Report</p>${table}<p>Notes</p>`
      const { blocks } = extractHtmlDocument()
      const workbook = await readWorkbook(Uint8Array.from(await convertXlsx(blocks)).buffer)
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Document'])
      expect(workbook.worksheets[0].getCell('A1').value).toBe('Report')
      expect(workbook.worksheets[0].getCell('A2').value).toBe('Notes')
    }
  )

  it('skips empty tables while preserving a header-only table', async () => {
    document.body.innerHTML = '<table></table><table><tr><th>Heading</th></tr></table>'
    const { blocks } = extractHtmlDocument()
    const workbook = await readWorkbook(Uint8Array.from(await convertXlsx(blocks)).buffer)
    expect(workbook.worksheets).toHaveLength(1)
    expect(workbook.worksheets[0].name).toBe('Table 1')
    expect(workbook.worksheets[0].getCell('A1').value).toBe('Heading')
    expect(workbook.worksheets[0].autoFilter).toBe('A1:A1')
  })
})
