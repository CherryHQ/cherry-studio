import { setImmediate as yieldToEventLoop } from 'node:timers/promises'

import type { DocumentBlock } from './parseMarkdown'

export async function convertXlsx(blocks: DocumentBlock[], signal?: AbortSignal): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const names = new Set<string>()
  let index = 0
  for (const block of blocks) {
    signal?.throwIfAborted()
    if (block.type !== 'table') continue
    index++
    const base =
      block.title
        .replace(/[\\/*?:[\]]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .trim() || `Table ${index}`
    let name = base.slice(0, 31).replace(/^'+|'+$/g, '')
    let suffix = 1
    while (names.has(name.toLowerCase()) || name.toLowerCase() === 'history') {
      const tail = ` (${++suffix})`
      name = base.slice(0, 31 - tail.length).replace(/^'+|'+$/g, '') + tail
    }
    names.add(name.toLowerCase())
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRows(block.rows)
    sheet.getRow(1).font = { bold: true }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: block.rows.length, column: block.rows[0].length } }
    sheet.columns.forEach((column, columnIndex) => {
      column.width = Math.min(60, Math.max(12, ...block.rows.map((row) => (row[columnIndex]?.length ?? 0) + 2)))
      column.alignment = { vertical: 'top', wrapText: true }
    })
    await yieldToEventLoop(undefined, { signal })
  }
  if (!index) {
    const sheet = workbook.addWorksheet('Document')
    sheet.getColumn(1).width = 90
    for (const block of blocks) {
      if ('text' in block) sheet.addRow([block.text]).alignment = { wrapText: true, vertical: 'top' }
    }
  }
  signal?.throwIfAborted()
  const buffer = await workbook.xlsx.writeBuffer()
  signal?.throwIfAborted()
  return Buffer.from(buffer)
}
