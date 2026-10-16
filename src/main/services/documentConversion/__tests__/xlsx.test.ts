// @vitest-environment jsdom

import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'

import { readWorkbook } from '@cherrystudio/spreadsheet'

import { extractHtmlDocument } from '../htmlDocument'
import { parseMarkdown } from '../parseMarkdown'
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

  it('publishes all rows and a bounded column width for a large supported Markdown table', async () => {
    const markdown = `| h |\n| --- |\n${'| x |\n'.repeat(149998)}| ${'wide'.repeat(20)} |\n| tail |\n`
    expect(Buffer.byteLength(markdown)).toBeLessThan(2 * 1024 * 1024)
    const archive = await JSZip.loadAsync(await convertXlsx(parseMarkdown(markdown)))
    const sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('string')
    const strings = new DOMParser().parseFromString(
      await archive.file('xl/sharedStrings.xml')!.async('string'),
      'text/xml'
    )
    const lastCell = sheet.match(/<c\b[^>]*\br="A150001"[^>]*>([\s\S]*?)<\/c>/)![1]
    const index = Number(lastCell.match(/<v>(\d+)<\/v>/)![1])
    expect(strings.getElementsByTagName('si')[index].textContent).toBe('tail')
    expect(sheet.match(/<row\b/g)).toHaveLength(150001)
    expect(sheet).toMatch(/<col\b[^>]*\bwidth="60"/)
  }, 30000)
})
