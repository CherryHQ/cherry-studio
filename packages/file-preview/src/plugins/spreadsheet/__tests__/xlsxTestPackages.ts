import ExcelJS from 'exceljs'
import JSZip from 'jszip'

type ChartWorkbookKind = 'basic' | 'no-cache' | 'unsupported'
type ChartTypeName = 'barChart' | 'lineChart' | 'pieChart' | 'areaChart' | 'scatterChart'

interface SeriesSpec {
  name: string
  nameRef: string
  categories: string[]
  categoryRef: string
  values: number[]
  valueRef: string
}

interface ChartSpec {
  typeName: ChartTypeName
  title: string
  series: SeriesSpec[]
  barDirection?: 'col' | 'bar'
  stacked?: boolean
}

const CATEGORIES = ['Q1', 'Q2', 'Q3', 'Q4']
const SERIES_A = [10, 20, 30, 40]
const SERIES_B = [5, 15, 25, 35]

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const DRAWING_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CONTENT_TYPE_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml'
const CONTENT_TYPE_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const toArrayBuffer = async (workbook: ExcelJS.Workbook): Promise<ArrayBuffer> => {
  const buf = await workbook.xlsx.writeBuffer()
  const view = buf as unknown as Uint8Array
  const arrayBuffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(arrayBuffer).set(view)
  return arrayBuffer
}

const createDataWorkbook = async (): Promise<JSZip> => {
  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet('Data')
  ws.addRow(['Category', 'SeriesA', 'SeriesB'])
  CATEGORIES.forEach((category, i) => {
    ws.addRow([category, SERIES_A[i], SERIES_B[i]])
  })

  return JSZip.loadAsync(await toArrayBuffer(workbook))
}

const baseSeriesA = (): SeriesSpec => ({
  name: 'SeriesA',
  nameRef: "'Data'!B1",
  categories: CATEGORIES,
  categoryRef: "'Data'!$A$2:$A$5",
  values: SERIES_A,
  valueRef: "'Data'!$B$2:$B$5"
})

const baseSeriesB = (): SeriesSpec => ({
  name: 'SeriesB',
  nameRef: "'Data'!C1",
  categories: CATEGORIES,
  categoryRef: "'Data'!$A$2:$A$5",
  values: SERIES_B,
  valueRef: "'Data'!$C$2:$C$5"
})

const chartSpecsFor = (kind: ChartWorkbookKind): ChartSpec[] => {
  if (kind === 'unsupported') {
    return [
      {
        typeName: 'scatterChart',
        title: 'Scatter Chart',
        series: [baseSeriesA()]
      }
    ]
  }

  if (kind === 'no-cache') {
    return [
      { typeName: 'barChart', title: 'Bar Chart', barDirection: 'col', series: [baseSeriesA()] },
      { typeName: 'lineChart', title: 'Line Chart', series: [baseSeriesA()] },
      { typeName: 'pieChart', title: 'Pie Chart', series: [baseSeriesA()] },
      { typeName: 'areaChart', title: 'Area Chart', series: [baseSeriesA()] }
    ]
  }

  return [
    {
      typeName: 'barChart',
      title: 'Bar Chart',
      barDirection: 'col',
      stacked: true,
      series: [baseSeriesA(), baseSeriesB()]
    },
    { typeName: 'barChart', title: 'Horizontal Bar Chart', barDirection: 'bar', series: [baseSeriesA()] },
    { typeName: 'lineChart', title: 'Line Chart', series: [baseSeriesA()] },
    { typeName: 'pieChart', title: 'Pie Chart', series: [baseSeriesA()] },
    { typeName: 'areaChart', title: 'Area Chart', series: [baseSeriesA()] }
  ]
}

const cacheXml = <T extends string | number>(tagName: 'strCache' | 'numCache', values: T[]): string => `
  <${tagName}>
    <ptCount val="${values.length}"/>
    ${values.map((value, i) => `<pt idx="${i}"><v>${escapeXml(String(value))}</v></pt>`).join('')}
  </${tagName}>`

const seriesXml = (series: SeriesSpec, includeCache: boolean): string => `
  <ser>
    <idx val="0"/>
    <tx>
      <strRef>
        <f>${escapeXml(series.nameRef)}</f>
        ${includeCache ? cacheXml('strCache', [series.name]) : ''}
      </strRef>
    </tx>
    <cat>
      <strRef>
        <f>${escapeXml(series.categoryRef)}</f>
        ${includeCache ? cacheXml('strCache', series.categories) : ''}
      </strRef>
    </cat>
    <val>
      <numRef>
        <f>${escapeXml(series.valueRef)}</f>
        ${includeCache ? cacheXml('numCache', series.values) : ''}
      </numRef>
    </val>
  </ser>`

const titleXml = (title: string): string => `
  <title>
    <tx>
      <rich>
        <a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:r><a:t>${escapeXml(title)}</a:t></a:r>
        </a:p>
      </rich>
    </tx>
  </title>`

const chartXml = (
  spec: ChartSpec,
  includeCache: boolean
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<chartSpace xmlns="${CHART_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <chart>
    ${titleXml(spec.title)}
    <plotArea>
      <${spec.typeName}>
        ${spec.typeName === 'barChart' ? `<barDir val="${spec.barDirection ?? 'col'}"/>` : ''}
        ${spec.stacked ? '<grouping val="stacked"/>' : ''}
        ${spec.series.map((series) => seriesXml(series, includeCache)).join('')}
      </${spec.typeName}>
    </plotArea>
  </chart>
</chartSpace>`

const oneCellAnchorXml = (chartRId: string, row: number): string => `
  <oneCellAnchor>
    <from><col>4</col><colOff>0</colOff><row>${row}</row><rowOff>0</rowOff></from>
    <ext cx="2857500" cy="1714500"/>
    <graphicFrame>
      <nvGraphicFramePr><cNvPr id="${row + 1}" name="Chart ${row + 1}"/><cNvGraphicFramePr/></nvGraphicFramePr>
      <xfrm/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="${CHART_NS}">
          <c:chart xmlns:c="${CHART_NS}" xmlns:r="${DRAWING_REL_NS}" r:id="${chartRId}"/>
        </a:graphicData>
      </a:graphic>
    </graphicFrame>
    <clientData/>
  </oneCellAnchor>`

const drawingXml = (chartCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns="${DRAWING_NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
${Array.from({ length: chartCount }, (_, i) => oneCellAnchorXml(`rId${i + 1}`, 1 + i * 16)).join('')}
</wsDr>`

const drawingRelsXml = (chartCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}">
${Array.from(
  { length: chartCount },
  (_, i) => `  <Relationship Id="rId${i + 1}" Type="${DRAWING_REL_NS}/chart" Target="../charts/chart${i + 1}.xml"/>`
).join('\n')}
</Relationships>`

const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}">
  <Relationship Id="rId1" Type="${DRAWING_REL_NS}/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`

const addContentTypeOverride = (xml: string, partName: string, contentType: string): string => {
  if (xml.includes(`PartName="${partName}"`)) return xml
  return xml.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`)
}

const addSheetDrawingReference = async (zip: JSZip): Promise<void> => {
  const sheetPath = 'xl/worksheets/sheet1.xml'
  const sheetXml = await zip.file(sheetPath)?.async('string')
  if (!sheetXml || sheetXml.includes('<drawing ')) return

  const drawingRef = '<drawing r:id="rId1"/>'
  const updated = sheetXml.includes('<pageMargins')
    ? sheetXml.replace('<pageMargins', `${drawingRef}<pageMargins`)
    : sheetXml.replace('</worksheet>', `${drawingRef}</worksheet>`)
  zip.file(sheetPath, updated)
}

export const buildChartWorkbookZip = async (kind: ChartWorkbookKind): Promise<JSZip> => {
  const zip = await createDataWorkbook()
  const specs = chartSpecsFor(kind)
  const includeCache = kind === 'basic'

  await addSheetDrawingReference(zip)
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', sheetRelsXml)
  zip.file('xl/drawings/drawing1.xml', drawingXml(specs.length))
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml(specs.length))
  specs.forEach((spec, i) => {
    zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(spec, includeCache))
  })

  const contentTypesFile = zip.file('[Content_Types].xml')
  const contentTypes = contentTypesFile ? await contentTypesFile.async('string') : null
  if (contentTypes) {
    let updated = addContentTypeOverride(contentTypes, '/xl/drawings/drawing1.xml', CONTENT_TYPE_DRAWING)
    specs.forEach((_, i) => {
      updated = addContentTypeOverride(updated, `/xl/charts/chart${i + 1}.xml`, CONTENT_TYPE_CHART)
    })
    zip.file('[Content_Types].xml', updated)
  }

  return zip
}

export const buildChartWorkbookArrayBuffer = async (kind: ChartWorkbookKind): Promise<ArrayBuffer> => {
  const zip = await buildChartWorkbookZip(kind)
  return zip.generateAsync({ type: 'arraybuffer' })
}
