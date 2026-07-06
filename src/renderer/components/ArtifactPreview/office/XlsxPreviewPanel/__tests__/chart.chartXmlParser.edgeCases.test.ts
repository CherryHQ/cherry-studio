import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX } from '../gridLayout'
import type { SheetDataAccessor, SheetLayoutAccessor } from '../worker/chartXmlParser'
import { parseCharts } from '../worker/chartXmlParser'

/**
 * Edge-case coverage using a minimal hand-assembled xlsx package (xlsx = zip of XML parts).
 * Only the OPC parts that parseCharts actually reads are included:
 *   xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/worksheets/_rels/sheet1.xml.rels,
 *   xl/drawings/drawing1.xml (+ .rels), xl/charts/chartN.xml
 * These are written with the standard Excel-style `c:`/`a:`/`r:` namespace prefixes;
 * the sibling test helper builds the unprefixed drawing variant used by openpyxl.
 */

const DEFAULT_LAYOUT: SheetLayoutAccessor = {
  colX: (col) => (col - 1) * DEFAULT_COL_WIDTH_PX,
  rowY: (row) => (row - 1) * DEFAULT_ROW_HEIGHT_PX
}

const emptyDataAccessor: SheetDataAccessor = {
  readRange: () => null
}

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

const SHEET_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`

/** Builds a base zip with workbook/rels wired to a single Sheet1, ready for a drawing + charts to be added. */
const buildBaseZip = (): JSZip => {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', WORKBOOK_XML)
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS_XML)
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', SHEET_RELS_XML)
  return zip
}

const twoCellAnchorXml = (chartRId: string) => `
  <xdr:twoCellAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
    <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame>
      <xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`

const absoluteAnchorXml = (chartRId: string) => `
  <xdr:absoluteAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
    <xdr:pos x="95250" y="190500"/>
    <xdr:ext cx="2857500" cy="1428750"/>
    <xdr:graphicFrame>
      <xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 2"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:absoluteAnchor>`

const wrapDrawing = (anchors: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${anchors}
</xdr:wsDr>`

const drawingRelsXml = (
  rels: { id: string; target: string }[]
) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.map((r) => `  <Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="${r.target}"/>`).join('\n')}
</Relationships>`

const CHART_NS = `xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`

describe('parseCharts — anchor kinds (Excel-style c:/a: prefixes)', () => {
  it('computes rect from twoCellAnchor via from/to point difference', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:ser>
                <c:idx val="0"/>
                <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:barChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(warnings).toEqual([])
    expect(charts).toHaveLength(1)
    // from: col=1,row=1 (0-based) → x=64px,y=20px ; to: col=5,row=10 (0-based) → x=320px,y=200px
    expect(charts[0].rect).toEqual({ x: DEFAULT_COL_WIDTH_PX, y: DEFAULT_ROW_HEIGHT_PX, width: 256, height: 180 })
  })

  it('computes rect from absoluteAnchor via pos + ext EMU', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:ser><c:idx val="0"/></c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(absoluteAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(1)
    // pos: x=95250 EMU=10px, y=190500 EMU=20px; ext: cx=2857500 EMU=300px, cy=1428750 EMU=150px
    expect(charts[0].rect).toEqual({ x: 10, y: 20, width: 300, height: 150 })
  })
})

describe('parseCharts — sparse cache idx padding', () => {
  it('pads missing idx entries with null up to ptCount', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:ser>
                <c:idx val="0"/>
                <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$5</c:f><c:strCache><c:ptCount val="4"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="3"><c:v>Q4</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f><c:numCache><c:ptCount val="4"/><c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="2"><c:v>30</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(warnings).toEqual([])
    expect(charts[0].series[0].categories).toEqual(['Q1', '', '', 'Q4'])
    expect(charts[0].series[0].values).toEqual([null, 20, 30, null])
  })
})

describe('parseCharts — hostile cache declarations are bounded', () => {
  const hostileValCacheChartXml = (numCache: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:ser>
                <c:idx val="0"/>
                <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache>${numCache}</c:numCache></c:numRef></c:val>
              </c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

  const twoCellDataAccessor: SheetDataAccessor = {
    readRange: () => [[10], [20]]
  }

  const buildHostileZip = (numCache: string): JSZip => {
    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', hostileValCacheChartXml(numCache))
    return zip
  }

  it('drops a cache declaring a huge ptCount and falls back to referenced cells', async () => {
    const zip = buildHostileZip('<c:ptCount val="2000000000"/><c:pt idx="0"><c:v>1</c:v></c:pt>')

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, twoCellDataAccessor)

    expect(warnings).toContain(
      'chart cache declares an out-of-range ptCount (2000000000); falling back to cell references'
    )
    expect(charts[0].series[0].values).toEqual([10, 20])
  })

  it('drops a cache containing a far-out sparse pt idx and falls back to referenced cells', async () => {
    const zip = buildHostileZip('<c:ptCount val="2"/><c:pt idx="999999999"><c:v>1</c:v></c:pt>')

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, twoCellDataAccessor)

    expect(warnings).toContain('chart cache point index out of range (999999999); falling back to cell references')
    expect(charts[0].series[0].values).toEqual([10, 20])
  })

  it('drops a cache with a non-integer ptCount and falls back to referenced cells', async () => {
    const zip = buildHostileZip('<c:ptCount val="2.5"/><c:pt idx="0"><c:v>1</c:v></c:pt>')

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, twoCellDataAccessor)

    expect(warnings.some((w) => w.includes('out-of-range ptCount'))).toBe(true)
    expect(charts[0].series[0].values).toEqual([10, 20])
  })
})

describe('parseCharts — percentStacked grouping is preserved distinctly', () => {
  it('parses c:grouping val="percentStacked" into stacking: "percentStacked"', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:grouping val="percentStacked"/>
              <c:ser>
                <c:idx val="0"/>
                <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:barChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts[0].stacking).toBe('percentStacked')
  })
})

describe('parseCharts — single series normalization', () => {
  it('treats a lone c:ser node (not an array) the same as an array of one', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:pieChart>
              <c:ser>
                <c:idx val="0"/>
                <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
                <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>
              </c:ser>
            </c:pieChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts[0].type).toBe('pie')
    expect(charts[0].series).toHaveLength(1)
    expect(charts[0].series[0].values).toEqual([1, 2])
  })
})

describe('parseCharts — combo chart degrades to first supported type', () => {
  it('picks the first supported plotArea chart child and warns about the rest', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:barChart>
            <c:lineChart>
              <c:ser><c:idx val="1"/><c:val><c:numRef><c:f>Sheet1!$C$2:$C$3</c:f></c:numRef></c:val></c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(1)
    expect(charts[0].type).toBe('bar')
    expect(warnings.some((w) => w.includes('combo chart'))).toBe(true)
  })
})

describe('parseCharts — doughnut/pie3D degrade to pie with a warning', () => {
  it('renders doughnutChart as pie and records a warning', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:doughnutChart>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:doughnutChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts[0].type).toBe('pie')
    expect(warnings.some((w) => w.includes('doughnutChart'))).toBe(true)
  })
})

describe('parseCharts — resilience to malformed chart parts', () => {
  it('drops only the chart whose part is malformed, keeping the others', async () => {
    const goodChartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:barChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    const anchors = twoCellAnchorXml('rId1') + twoCellAnchorXml('rId2')
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(anchors))
    zip.file(
      'xl/drawings/_rels/drawing1.xml.rels',
      drawingRelsXml([
        { id: 'rId1', target: '../charts/chart1.xml' },
        { id: 'rId2', target: '../charts/chart2.xml' }
      ])
    )
    zip.file('xl/charts/chart1.xml', goodChartXml)
    // chart2 is missing entirely from the zip — simulates a broken/absent part.

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(1)
    expect(charts[0].type).toBe('bar')
    expect(warnings.some((w) => w.includes('chart part missing'))).toBe(true)
  })

  it('drops a chart with unparseable XML content, keeping the other charts alive', async () => {
    const goodChartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:lineChart>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:lineChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    const anchors = twoCellAnchorXml('rId1') + twoCellAnchorXml('rId2')
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(anchors))
    zip.file(
      'xl/drawings/_rels/drawing1.xml.rels',
      drawingRelsXml([
        { id: 'rId1', target: '../charts/chart1.xml' },
        { id: 'rId2', target: '../charts/chart2.xml' }
      ])
    )
    zip.file('xl/charts/chart1.xml', goodChartXml)
    // No c:chartSpace/c:chart/c:plotArea structure at all — not a recognizable chart part.
    zip.file('xl/charts/chart2.xml', '<<<not xml at all>>>')

    const { charts, warnings } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(1)
    expect(charts[0].type).toBe('line')
    expect(warnings.some((w) => w.includes('failed to parse chart'))).toBe(true)
  })
})

describe('parseCharts — title from rich text run concatenation', () => {
  it('concatenates multiple a:t runs into the title text', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:title><c:tx><c:rich><a:p><a:r><a:t>Sales </a:t></a:r><a:r><a:t>2026</a:t></a:r></a:p></c:rich></c:tx></c:title>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:barChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts[0].title).toBe('Sales 2026')
  })

  it('leaves title undefined when there is no c:title node', async () => {
    const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <c:chartSpace ${CHART_NS}>
        <c:chart>
          <c:plotArea>
            <c:barChart>
              <c:barDir val="col"/>
              <c:ser><c:idx val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
            </c:barChart>
          </c:plotArea>
        </c:chart>
      </c:chartSpace>`

    const zip = buildBaseZip()
    zip.file('xl/drawings/drawing1.xml', wrapDrawing(twoCellAnchorXml('rId1')))
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml([{ id: 'rId1', target: '../charts/chart1.xml' }]))
    zip.file('xl/charts/chart1.xml', chartXml)

    const { charts } = await parseCharts(zip, 'Sheet1', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts[0].title).toBeUndefined()
  })
})
