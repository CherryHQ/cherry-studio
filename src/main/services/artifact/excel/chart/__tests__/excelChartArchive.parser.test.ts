import type { ExcelPreviewImageRenderData } from '@shared/types/excelPreview'
import type StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExcelChartRenderModel } from '../excelChartTypes'

const mocks = vi.hoisted(() => ({
  getExcelChartRenderSize: vi.fn((model: ExcelChartRenderModel) => model.anchor.size ?? { height: 120, width: 240 }),
  renderExcelChartImage: vi.fn()
}))

vi.mock('../excelChartRenderer', () => ({
  getExcelChartRenderSize: mocks.getExcelChartRenderSize,
  renderExcelChartImage: mocks.renderExcelChartImage
}))

const { collectWorksheetChartImages } = await import('../excelChartArchive')

type FakeZipEntry = {
  name: string
}

const createZip = (entries: Record<string, string>): StreamZip.StreamZipAsync =>
  ({
    entry: async (entryName: string) =>
      entries[entryName] === undefined ? undefined : ({ name: entryName } satisfies FakeZipEntry),
    entryData: async (entry: FakeZipEntry) => Buffer.from(entries[entry.name] ?? '')
  }) as unknown as StreamZip.StreamZipAsync

const worksheet = {
  worksheet: {
    drawing: { id: 'rId1' },
    sheetData: {
      row: [
        {
          c: [
            { r: 'A1', t: 's', v: '0' },
            { r: 'B1', t: 's', v: '1' }
          ]
        },
        {
          c: [
            { r: 'A2', t: 's', v: '2' },
            { r: 'B2', v: 12 }
          ]
        },
        {
          c: [
            { r: 'A3', t: 's', v: '3' },
            { r: 'B3', v: 30 }
          ]
        }
      ]
    }
  }
}

const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  <twoCellAnchor>
    <from><col>0</col><colOff>0</colOff><row>4</row><rowOff>0</rowOff></from>
    <to><col>3</col><colOff>0</colOff><row>10</row><rowOff>0</rowOff></to>
    <graphicFrame>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
    </graphicFrame>
    <clientData/>
  </twoCellAnchor>
</wsDr>`

const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx>
    </c:title>
    <c:plotArea>
      <c:barChart>
        <c:barDir val="col"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Data!$A$2:$A$3</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Data!$B$2:$B$3</c:f></c:numRef></c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`

const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Region</t></si>
  <si><t>Amount</t></si>
  <si><t>North</t></si>
  <si><r><t>South</t></r></si>
</sst>`

const createChartZip = (): StreamZip.StreamZipAsync =>
  createZip({
    'xl/worksheets/_rels/sheet1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml"/>
</Relationships>`,
    'xl/drawings/drawing1.xml': drawingXml,
    'xl/drawings/_rels/drawing1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml"/>
</Relationships>`,
    'xl/charts/chart1.xml': chartXml,
    'xl/sharedStrings.xml': sharedStringsXml
  })

const collectImages = () =>
  collectWorksheetChartImages({
    fileNumber: '1',
    sheetId: 'sheet-1',
    sheetName: 'Data',
    worksheet,
    worksheetXml: '',
    zip: createChartZip()
  })

describe('collectWorksheetChartImages parser behavior', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.getExcelChartRenderSize.mockClear()
    mocks.renderExcelChartImage.mockReset()
    mocks.renderExcelChartImage.mockImplementation(
      async (model: ExcelChartRenderModel): Promise<ExcelPreviewImageRenderData> => ({
        from: model.anchor.from,
        id: model.id,
        source: 'data:image/png;base64,chart',
        ...(model.anchor.size ? { size: model.anchor.size } : {}),
        ...(model.anchor.to ? { to: model.anchor.to } : {})
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes rich text chart titles and shared string formula fallback values into the render model', async () => {
    const result = await collectImages()

    expect(result.diagnostics).toEqual([])
    expect(result.images).toHaveLength(1)
    expect(mocks.renderExcelChartImage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sales',
        series: [
          expect.objectContaining({
            categories: ['North', 'South'],
            name: 'Amount',
            values: [12, 30]
          })
        ]
      })
    )
  })

  it('waits for chart rendering instead of resolving on a detached timeout', async () => {
    vi.useFakeTimers()

    let resolveRender: (image: ExcelPreviewImageRenderData) => void = () => {}
    mocks.renderExcelChartImage.mockReturnValueOnce(
      new Promise<ExcelPreviewImageRenderData>((resolve) => {
        resolveRender = resolve
      })
    )

    let settled = false
    const resultPromise = collectImages().then((result) => {
      settled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(2_500)
    expect(settled).toBe(false)

    resolveRender({
      from: { column: 0, columnOffset: 0, row: 4, rowOffset: 0 },
      id: 'sheet-1-chart-1',
      source: 'data:image/png;base64,chart',
      to: { column: 3, columnOffset: 0, row: 10, rowOffset: 0 }
    })

    await expect(resultPromise).resolves.toMatchObject({
      diagnostics: [],
      images: [{ id: 'sheet-1-chart-1' }]
    })
  })
})
