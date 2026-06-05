import type StreamZip from 'node-stream-zip'
import { describe, expect, it } from 'vitest'

import { collectWorksheetChartImages } from '../excelChartArchive'
import type { ExcelChartKind } from '../excelChartTypes'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

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
            { is: { t: 'Region' }, r: 'A1', t: 'inlineStr' },
            { is: { t: 'Amount' }, r: 'B1', t: 'inlineStr' }
          ]
        },
        {
          c: [
            { is: { t: 'North' }, r: 'A2', t: 'inlineStr' },
            { r: 'B2', v: 12 }
          ]
        },
        {
          c: [
            { is: { t: 'South' }, r: 'A3', t: 'inlineStr' },
            { r: 'B3', v: 30 }
          ]
        }
      ]
    }
  }
}

const categorySeriesXml = `
<c:ser>
  <c:idx val="0"/>
  <c:order val="0"/>
  <c:tx>
    <c:strRef>
      <c:f>Data!$B$1</c:f>
      <c:strCache><c:pt idx="0"><c:v>Amount</c:v></c:pt></c:strCache>
    </c:strRef>
  </c:tx>
  <c:cat>
    <c:strRef>
      <c:f>Data!$A$2:$A$3</c:f>
      <c:strCache><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South</c:v></c:pt></c:strCache>
    </c:strRef>
  </c:cat>
  <c:val>
    <c:numRef>
      <c:f>Data!$B$2:$B$3</c:f>
      <c:numCache><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt></c:numCache>
    </c:numRef>
  </c:val>
</c:ser>`

const formulaSeriesXml = `
<c:ser>
  <c:idx val="0"/>
  <c:order val="0"/>
  <c:tx><c:strRef><c:f>Data!$B$1</c:f></c:strRef></c:tx>
  <c:cat><c:strRef><c:f>Data!$A$2:$A$3</c:f></c:strRef></c:cat>
  <c:val><c:numRef><c:f>Data!$B$2:$B$3</c:f></c:numRef></c:val>
</c:ser>`

const scatterSeriesXml = `
<c:ser>
  <c:idx val="0"/>
  <c:order val="0"/>
  <c:tx><c:v>Points</c:v></c:tx>
  <c:xVal>
    <c:numRef>
      <c:f>Data!$A$2:$A$3</c:f>
      <c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache>
    </c:numRef>
  </c:xVal>
  <c:yVal>
    <c:numRef>
      <c:f>Data!$B$2:$B$3</c:f>
      <c:numCache><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt></c:numCache>
    </c:numRef>
  </c:yVal>
</c:ser>`

const chartNodeXml = (kind: ExcelChartKind): string => {
  if (kind === 'column' || kind === 'bar') {
    return `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/>${categorySeriesXml}</c:barChart>`
  }

  if (kind === 'scatter') return `<c:scatterChart>${scatterSeriesXml}</c:scatterChart>`

  return `<c:${kind}Chart>${categorySeriesXml}</c:${kind}Chart>`
}

const chartXml = (plotAreaXml: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx>
    </c:title>
    <c:plotArea>${plotAreaXml}</c:plotArea>
  </c:chart>
</c:chartSpace>`

const twoCellAnchorXml = `
<twoCellAnchor>
  <from><col>1</col><colOff>0</colOff><row>4</row><rowOff>0</rowOff></from>
  <to><col>6</col><colOff>0</colOff><row>16</row><rowOff>0</rowOff></to>
  <graphicFrame>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
  </graphicFrame>
  <clientData/>
</twoCellAnchor>`

const oneCellAnchorXml = `
<oneCellAnchor>
  <from><col>2</col><colOff>0</colOff><row>5</row><rowOff>0</rowOff></from>
  <ext cx="1905000" cy="952500"/>
  <graphicFrame>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
  </graphicFrame>
  <clientData/>
</oneCellAnchor>`

const createChartZip = (chartContent: string, anchorXml = twoCellAnchorXml): StreamZip.StreamZipAsync =>
  createZip({
    'xl/worksheets/_rels/sheet1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml"/>
</Relationships>`,
    'xl/drawings/drawing1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  ${anchorXml}
</wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml"/>
</Relationships>`,
    'xl/charts/chart1.xml': chartContent
  })

const collectImages = (plotAreaXml: string, anchorXml?: string) =>
  collectWorksheetChartImages({
    fileNumber: '1',
    sheetId: 'sheet-1',
    sheetName: 'Data',
    worksheet,
    worksheetXml: '',
    zip: createChartZip(chartXml(plotAreaXml), anchorXml)
  })

describe('collectWorksheetChartImages', () => {
  it.each<ExcelChartKind>(['column', 'bar', 'line', 'area', 'pie', 'scatter'])(
    'parses and renders %s chart drawings',
    async (kind) => {
      const result = await collectImages(chartNodeXml(kind))
      const encodedPng = result.images[0]?.source.replace('data:image/png;base64,', '')

      expect(result.diagnostics).toEqual([])
      expect(result.images[0]).toMatchObject({
        from: { column: 1, columnOffset: 0, row: 4, rowOffset: 0 },
        id: 'sheet-1-chart-1',
        size: { height: 276, width: 440 },
        source: expect.stringMatching(/^data:image\/png;base64,/),
        to: { column: 6, columnOffset: 0, row: 16, rowOffset: 0 }
      })
      expect(encodedPng ? Buffer.from(encodedPng, 'base64').subarray(0, 4) : null).toEqual(PNG_SIGNATURE)
    }
  )

  it('parses one-cell anchors with explicit chart size', async () => {
    const result = await collectImages(chartNodeXml('column'), oneCellAnchorXml)

    expect(result.diagnostics).toEqual([])
    expect(result.images[0]).toMatchObject({
      from: { column: 2, columnOffset: 0, row: 5, rowOffset: 0 },
      size: { height: 100, width: 200 }
    })
    expect(result.images[0]?.to).toBeUndefined()
  })

  it('uses worksheet range values when chart caches are absent', async () => {
    const result = await collectImages(`<c:lineChart>${formulaSeriesXml}</c:lineChart>`)

    expect(result.diagnostics).toEqual([])
    expect(result.images).toHaveLength(1)
  })

  it('throws when chart image dimensions exceed the pixel budget', async () => {
    await expect(
      collectWorksheetChartImages({
        budget: { maxChartPixels: 1 },
        fileNumber: '1',
        sheetId: 'sheet-1',
        sheetName: 'Data',
        worksheet,
        worksheetXml: '',
        zip: createChartZip(chartXml(chartNodeXml('column')))
      })
    ).rejects.toMatchObject({ name: 'ExcelWorkbookPreviewBudgetExceededError' })
  })

  it('throws when rendered chart images exceed the payload budget', async () => {
    await expect(
      collectWorksheetChartImages({
        budget: { maxChartPayloadBytes: 1 },
        fileNumber: '1',
        sheetId: 'sheet-1',
        sheetName: 'Data',
        worksheet,
        worksheetXml: '',
        zip: createChartZip(chartXml(chartNodeXml('column')))
      })
    ).rejects.toMatchObject({ name: 'ExcelWorkbookPreviewBudgetExceededError' })
  })

  it('reports combination charts as unsupported', async () => {
    const result = await collectImages(`${chartNodeXml('column')}${chartNodeXml('line')}`)

    expect(result.images).toEqual([])
    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported_excel_charts',
        count: 1,
        message: 'Charts are not rendered in Excel preview yet.',
        severity: 'warning'
      }
    ])
  })
})
