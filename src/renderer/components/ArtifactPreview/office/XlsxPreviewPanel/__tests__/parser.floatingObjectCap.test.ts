import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX, MAX_FLOATING_OBJECTS } from '../gridLayout'
import type { SheetDataAccessor, SheetLayoutAccessor } from '../worker/chartXmlParser'
import { parseCharts } from '../worker/chartXmlParser'
import { parseWorkbook } from '../worker/parseWorkbook'
import { buildChartWorkbookZip } from './xlsxTestPackages'

/**
 * Floating-object flood guard: anchor counts in drawing XML are untrusted, so a small workbook repeating thousands
 * of anchors must neither pin the worker (re-reading/re-parsing the same chart part per anchor) nor flood the
 * renderer with chart hosts / img nodes. Images and charts share the per-sheet MAX_FLOATING_OBJECTS budget.
 */

const DEFAULT_LAYOUT: SheetLayoutAccessor = {
  colX: (col) => (col - 1) * DEFAULT_COL_WIDTH_PX,
  rowY: (row) => (row - 1) * DEFAULT_ROW_HEIGHT_PX
}

const emptyDataAccessor: SheetDataAccessor = {
  readRange: () => null
}

/** Same shape as the generator drawing, but with every anchor pointing at the same chart relationship. */
const repeatedAnchorDrawingXml = (
  anchorCount: number,
  chartRId: string
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${Array.from(
  { length: anchorCount },
  (_, i) => `
  <oneCellAnchor>
    <from><col>4</col><colOff>0</colOff><row>${1 + i}</row><rowOff>0</rowOff></from>
    <ext cx="2857500" cy="1714500"/>
    <graphicFrame>
      <nvGraphicFramePr><cNvPr id="${i + 1}" name="Chart ${i + 1}"/><cNvGraphicFramePr/></nvGraphicFramePr>
      <xfrm/>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRId}"/>
        </a:graphicData>
      </a:graphic>
    </graphicFrame>
    <clientData/>
  </oneCellAnchor>`
).join('')}
</wsDr>`

describe('parseCharts — floating-object cap and chart part memoization', () => {
  it('caps repeated anchors at the budget and reads the shared chart part only once', async () => {
    const zip = await buildChartWorkbookZip('basic')
    zip.file('xl/drawings/drawing1.xml', repeatedAnchorDrawingXml(MAX_FLOATING_OBJECTS + 36, 'rId1'))

    const fileSpy = vi.spyOn(zip, 'file')
    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(MAX_FLOATING_OBJECTS)
    expect(warnings.some((w) => w.includes('floating-objects-truncated'))).toBe(true)
    // Each anchor gets its own rect, but the shared part is read from the zip a single time.
    const chartPartReads = fileSpy.mock.calls.filter(([path]) => path === 'xl/charts/chart1.xml')
    expect(chartPartReads).toHaveLength(1)
    expect(charts[0].rect.y).not.toBe(charts[1].rect.y)
  })

  it('respects an explicit remaining budget, including zero', async () => {
    const zip = await buildChartWorkbookZip('basic')

    const { charts } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor, 2)
    expect(charts).toHaveLength(2)

    const { charts: none, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor, 0)
    expect(none).toHaveLength(0)
    expect(warnings.some((w) => w.includes('floating-objects-truncated'))).toBe(true)
  })

  it('keeps all anchors when under the budget', async () => {
    const zip = await buildChartWorkbookZip('basic')
    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(5)
    expect(warnings).toEqual([])
  })
})

describe('parseWorkbook — floating image cap', () => {
  const PNG_BASE64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  it('truncates image anchors beyond the per-sheet budget with a warning', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S1')
    const imgId = wb.addImage({ base64: PNG_BASE64, extension: 'png' })
    for (let i = 0; i < MAX_FLOATING_OBJECTS + 8; i++) {
      // addImage types require tl/br to be Anchor instances, but runtime accepts plain { col, row } objects.
      ws.addImage(imgId, { tl: { col: 0, row: i }, ext: { width: 10, height: 10 } } as unknown as ExcelJS.ImagePosition)
    }

    const buf = await wb.xlsx.writeBuffer()
    const view = buf as unknown as Uint8Array
    const arrayBuffer = new ArrayBuffer(view.byteLength)
    new Uint8Array(arrayBuffer).set(view)
    const model = await parseWorkbook(arrayBuffer, 'image-flood.xlsx')

    expect(model.sheets[0].floatingImages).toHaveLength(MAX_FLOATING_OBJECTS)
    expect(model.warnings).toContain('floating-objects-truncated')
  })
})
