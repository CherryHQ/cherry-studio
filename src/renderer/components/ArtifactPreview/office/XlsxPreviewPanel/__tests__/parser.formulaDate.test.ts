import ExcelJS from 'exceljs'
import { beforeAll, describe, expect, it } from 'vitest'

import type { WorkbookRenderModel } from '../renderModel'
import { parseWorkbook } from '../worker/parseWorkbook'

async function toArrayBuffer(workbook: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buf = await workbook.xlsx.writeBuffer()
  const view = buf as unknown as Uint8Array
  const arrayBuffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(arrayBuffer).set(view)
  return arrayBuffer
}

/**
 * A formula referencing a date cell must keep Excel serial-number semantics. The render model stores the ISO raw for
 * dates, but the formula-evaluation context needs a numeric serial so =A1+1 yields the next day rather than a value
 * error from string arithmetic.
 */
describe('parseWorkbook — date cells carry serial semantics into formulas', () => {
  let model: WorkbookRenderModel

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')

    ws.getCell('A1').value = new Date(Date.UTC(2026, 0, 15))
    ws.getCell('A1').numFmt = 'yyyy-mm-dd'
    // No cached result: the parser must run the evaluator, which reads A1 from the raw value table.
    ws.getCell('B1').value = { formula: 'A1+1' }
    ws.getCell('B1').numFmt = 'yyyy-mm-dd'

    const buffer = await toArrayBuffer(wb)
    model = await parseWorkbook(buffer, 'formula-date.xlsx')
  })

  it('keeps the ISO raw on the date cell itself', () => {
    const a1 = model.sheets[0].cells['1:1']
    expect(typeof a1.raw).toBe('string')
    expect(a1.raw).toContain('2026-01-15')
  })

  it('evaluates =A1+1 to the next day instead of failing on the ISO string', () => {
    const b1 = model.sheets[0].cells['1:2']
    expect(b1.formulaState).toBe('evaluated')
    expect(typeof b1.raw).toBe('number')
    expect(b1.text).toBe('2026-01-16')
  })
})
