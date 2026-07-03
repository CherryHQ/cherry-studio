import { XMLParser } from 'fast-xml-parser'
import type JSZip from 'jszip'

import { emuToPx } from '../gridLayout'
import type { ChartModel, ChartSeries, ChartType, PxRect } from '../renderModel'

/**
 * drawing + chart XML → ChartModel[]:OPC 部件链、cache 优先/引用回填、锚点换算
 */

export interface SheetDataAccessor {
  /** A1 风格区间引用(可含 sheet 名)→ 原始值二维数组;引用无效返回 null */
  readRange(ref: string): (string | number | null)[][] | null
}

export interface SheetLayoutAccessor {
  /** 列左边缘累计偏移(px, zoom=1),col 为 1-based */
  colX(col: number): number
  /** 行上边缘累计偏移(px, zoom=1),row 为 1-based */
  rowY(row: number): number
}

export interface ParsedCharts {
  charts: ChartModel[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// XML 解析工具
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  removeNSPrefix: false,
  // 富文本(标题)运行片段之间的空格有意义(如 'Sales ' + '2026'),不能被裁剪
  trimValues: false
})

/** 任意 fast-xml-parser 产出的节点值:元素(对象/数组)或原始值 */
type XmlNode = Record<string, unknown>

/** 去掉命名空间前缀,如 'c:chart' → 'chart'、'a:t' → 't' */
const localName = (tag: string): string => {
  const idx = tag.indexOf(':')
  return idx === -1 ? tag : tag.slice(idx + 1)
}

/** 在对象节点上按 local name 查找子节点(兼容 'c:xxx' 与 'xxx' 两种命名空间前缀写法) */
const findChild = (node: unknown, name: string): unknown => {
  if (!node || typeof node !== 'object') return undefined
  const obj = node as XmlNode
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue
    if (localName(key) === name) return obj[key]
  }
  return undefined
}

/** 按 local name 查找全部匹配子节点,统一归一化为数组(fast-xml-parser 单个子节点不产出数组) */
const findChildren = (node: unknown, name: string): unknown[] => {
  const found = findChild(node, name)
  if (found === undefined) return []
  return Array.isArray(found) ? found : [found]
}

/** 遍历对象节点的全部直接子节点,返回 [localName, value][],跳过属性 */
const entries = (node: unknown): [string, unknown][] => {
  if (!node || typeof node !== 'object') return []
  const obj = node as XmlNode
  return Object.keys(obj)
    .filter((key) => !key.startsWith('@_'))
    .map((key) => [localName(key), obj[key]])
}

/** 按 local name 查找属性(兼容 'r:id' 与 'id' 两种命名空间前缀写法) */
const getAttr = (node: unknown, attr: string): string | undefined => {
  if (!node || typeof node !== 'object') return undefined
  const obj = node as XmlNode
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('@_')) continue
    if (localName(key.slice(2)) === attr) {
      const value = obj[key]
      return value === undefined ? undefined : String(value)
    }
  }
  return undefined
}

/** `<tag val="x"/>` 形式节点取 val 属性 */
const valAttr = (node: unknown): string | undefined => getAttr(node, 'val')

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isNaN(n) ? undefined : n
}

// ---------------------------------------------------------------------------
// OPC 部件解析:relationships
// ---------------------------------------------------------------------------

interface Relationship {
  id: string
  type: string
  target: string
}

const parseRelationships = (xml: string): Relationship[] => {
  const doc = xmlParser.parse(xml)
  const root = findChild(doc, 'Relationships')
  return findChildren(root, 'Relationship').map((rel) => ({
    id: getAttr(rel, 'Id') ?? '',
    type: getAttr(rel, 'Type') ?? '',
    target: getAttr(rel, 'Target') ?? ''
  }))
}

/** 解析 rels target 相对路径(相对于 baseDir)或绝对路径(以 '/' 开头,相对包根) */
const resolveTarget = (baseDir: string, target: string): string => {
  if (target.startsWith('/')) return target.slice(1)
  const baseParts = baseDir.split('/').filter(Boolean)
  const targetParts = target.split('/')
  for (const part of targetParts) {
    if (part === '.' || part === '') continue
    if (part === '..') baseParts.pop()
    else baseParts.push(part)
  }
  return baseParts.join('/')
}

const readZipText = async (zip: JSZip, path: string): Promise<string | null> => {
  const file = zip.file(path)
  if (!file) return null
  return file.async('string')
}

/** sheet 名 → worksheet 部件路径,经 workbook.xml + workbook.xml.rels 解出 */
const resolveSheetPartPath = async (zip: JSZip, sheetName: string): Promise<string | null> => {
  const workbookXml = await readZipText(zip, 'xl/workbook.xml')
  if (!workbookXml) return null
  const doc = xmlParser.parse(workbookXml)
  const workbook = findChild(doc, 'workbook')
  const sheets = findChildren(findChild(workbook, 'sheets'), 'sheet')
  const sheetEntry = sheets.find((s) => getAttr(s, 'name') === sheetName)
  if (!sheetEntry) return null
  const rId = getAttr(sheetEntry, 'id') // r:id → localName 'id'
  if (!rId) return null

  const relsXml = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
  if (!relsXml) return null
  const rels = parseRelationships(relsXml)
  const rel = rels.find((r) => r.id === rId)
  if (!rel) return null
  return resolveTarget('xl', rel.target)
}

/** worksheet 部件路径 → drawing 部件路径,经 sheetN.xml.rels 解出 */
const resolveDrawingPartPath = async (zip: JSZip, sheetPartPath: string): Promise<string | null> => {
  const dir = sheetPartPath.split('/').slice(0, -1).join('/')
  const fileName = sheetPartPath.split('/').pop() ?? ''
  const relsPath = `${dir}/_rels/${fileName}.rels`
  const relsXml = await readZipText(zip, relsPath)
  if (!relsXml) return null
  const rels = parseRelationships(relsXml)
  const rel = rels.find((r) => r.type.endsWith('/drawing'))
  if (!rel) return null
  return resolveTarget(dir, rel.target)
}

// ---------------------------------------------------------------------------
// drawing XML → 锚点 + chart part 引用
// ---------------------------------------------------------------------------

interface AnchoredChartRef {
  rect: PxRect
  chartRId: string
}

const readAnchorPoint = (node: unknown): { col: number; colOff: number; row: number; rowOff: number } => ({
  col: toNumber(findChild(node, 'col')) ?? 0,
  colOff: toNumber(findChild(node, 'colOff')) ?? 0,
  row: toNumber(findChild(node, 'row')) ?? 0,
  rowOff: toNumber(findChild(node, 'rowOff')) ?? 0
})

const anchorPointToPx = (
  point: { col: number; colOff: number; row: number; rowOff: number },
  layout: SheetLayoutAccessor
): { x: number; y: number } => ({
  // col/row 属性是 0-based;layout.colX/rowY 接口是 1-based 累计偏移
  x: layout.colX(point.col + 1) + emuToPx(point.colOff),
  y: layout.rowY(point.row + 1) + emuToPx(point.rowOff)
})

/** 从单个锚点节点(twoCellAnchor/oneCellAnchor/absoluteAnchor)中取出 graphicFrame → chart 的 rId,并算出 PxRect */
const extractAnchoredChart = (
  anchorNode: unknown,
  kind: 'twoCellAnchor' | 'oneCellAnchor' | 'absoluteAnchor',
  layout: SheetLayoutAccessor
): AnchoredChartRef | null => {
  const graphicFrame = findChild(anchorNode, 'graphicFrame')
  if (!graphicFrame) return null // pic(图片)或其他,忽略

  const graphic = findChild(graphicFrame, 'graphic')
  const graphicData = findChild(graphic, 'graphicData')
  const chartNode = findChild(graphicData, 'chart')
  if (!chartNode) return null

  const chartRId = getAttr(chartNode, 'id')
  if (!chartRId) return null

  let rect: PxRect
  if (kind === 'twoCellAnchor') {
    const from = anchorPointToPx(readAnchorPoint(findChild(anchorNode, 'from')), layout)
    const to = anchorPointToPx(readAnchorPoint(findChild(anchorNode, 'to')), layout)
    rect = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }
  } else if (kind === 'oneCellAnchor') {
    const from = anchorPointToPx(readAnchorPoint(findChild(anchorNode, 'from')), layout)
    const ext = findChild(anchorNode, 'ext')
    rect = {
      x: from.x,
      y: from.y,
      width: emuToPx(toNumber(getAttr(ext, 'cx')) ?? 0),
      height: emuToPx(toNumber(getAttr(ext, 'cy')) ?? 0)
    }
  } else {
    const pos = findChild(anchorNode, 'pos')
    const ext = findChild(anchorNode, 'ext')
    rect = {
      x: emuToPx(toNumber(getAttr(pos, 'x')) ?? 0),
      y: emuToPx(toNumber(getAttr(pos, 'y')) ?? 0),
      width: emuToPx(toNumber(getAttr(ext, 'cx')) ?? 0),
      height: emuToPx(toNumber(getAttr(ext, 'cy')) ?? 0)
    }
  }

  return { rect, chartRId }
}

const ANCHOR_KINDS = ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'] as const

const extractAnchoredCharts = (drawingXml: string, layout: SheetLayoutAccessor): AnchoredChartRef[] => {
  const doc = xmlParser.parse(drawingXml)
  const root = findChild(doc, 'wsDr')
  const results: AnchoredChartRef[] = []
  for (const kind of ANCHOR_KINDS) {
    for (const anchorNode of findChildren(root, kind)) {
      const extracted = extractAnchoredChart(anchorNode, kind, layout)
      if (extracted) results.push(extracted)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// chart XML → ChartModel
// ---------------------------------------------------------------------------

const PLOT_AREA_TYPE_MAP: Record<string, ChartType> = {
  barChart: 'bar',
  lineChart: 'line',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'pie',
  areaChart: 'area'
}

/** 富文本节点(title 的 tx/rich,或 strRef 缺失时的字面量)拼接纯文本,取全部 a:t */
const collectText = (node: unknown, acc: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, acc)
    return acc
  }
  if (!node || typeof node !== 'object') return acc
  for (const [name, value] of entries(node)) {
    if (name === 't' && typeof value !== 'object') {
      acc.push(String(value))
    } else {
      collectText(value, acc)
    }
  }
  return acc
}

const parseTitle = (chartNode: unknown): string | undefined => {
  const title = findChild(chartNode, 'title')
  if (!title) return undefined
  const text = collectText(title).join('')
  return text.length > 0 ? text : undefined
}

/** numCache/strCache → 按 idx 补齐到 ptCount 长度的数组(缺失 idx → null) */
const readCache = (refNode: unknown, cacheTag: string): (string | number | null)[] | null => {
  const cache = findChild(refNode, cacheTag)
  if (!cache) return null
  const ptCount = toNumber(valAttr(findChild(cache, 'ptCount'))) ?? 0
  const pts = findChildren(cache, 'pt')
  if (pts.length === 0 && ptCount === 0) return null

  const result: (string | number | null)[] = new Array(ptCount).fill(null)
  for (const pt of pts) {
    const idx = toNumber(getAttr(pt, 'idx'))
    if (idx === undefined) continue
    const vNode = findChild(pt, 'v')
    const raw = typeof vNode === 'object' ? undefined : vNode
    if (raw === undefined) continue
    const value = cacheTag === 'numCache' ? (toNumber(raw) ?? null) : String(raw)
    if (idx < result.length) {
      result[idx] = value
    } else {
      // ptCount 与实际 idx 不一致时兜底扩展
      while (result.length <= idx) result.push(null)
      result[idx] = value
    }
  }
  return result
}

/** 取 numRef/strRef 的 f(引用公式串),不含 sheet 前缀处理(交给 SheetDataAccessor) */
const readRefFormula = (refNode: unknown): string | undefined => {
  const f = findChild(refNode, 'f')
  return typeof f === 'string' || typeof f === 'number' ? String(f) : undefined
}

/** c:cat 或 c:val 节点(内部是 numRef 或 strRef)→ 数据数组 + 引用串 */
const readDataSource = (sourceNode: unknown): { cache: (string | number | null)[] | null; ref: string | undefined } => {
  if (!sourceNode) return { cache: null, ref: undefined }
  const numRef = findChild(sourceNode, 'numRef')
  const strRef = findChild(sourceNode, 'strRef')
  const refNode = numRef ?? strRef
  const cacheTag = numRef ? 'numCache' : 'strCache'
  const cache = readCache(refNode, cacheTag)
  const ref = readRefFormula(refNode)
  return { cache, ref }
}

/** name 来源:c:tx → strRef(优先 cache,其次引用回填)或字面 c:v */
const readSeriesName = (txNode: unknown, data: SheetDataAccessor, warnings: string[]): string | undefined => {
  if (!txNode) return undefined
  const strRef = findChild(txNode, 'strRef')
  if (strRef) {
    const cache = readCache(strRef, 'strCache')
    if (cache && cache.length > 0 && cache[0] !== null) return String(cache[0])
    const ref = readRefFormula(strRef)
    if (ref) {
      const rows = safeReadRange(data, ref, warnings)
      const first = rows?.[0]?.[0]
      if (first !== null && first !== undefined) return String(first)
    }
    return undefined
  }
  const literal = findChild(txNode, 'v')
  return typeof literal === 'object' ? undefined : literal !== undefined ? String(literal) : undefined
}

const safeReadRange = (
  data: SheetDataAccessor,
  ref: string,
  warnings: string[]
): (string | number | null)[][] | null => {
  try {
    return data.readRange(ref)
  } catch (err) {
    warnings.push(`chart data reference failed: ${ref} (${(err as Error).message})`)
    return null
  }
}

/** 二维区域读取结果展平为一维(区间通常是单行或单列) */
const flattenRange = (rows: (string | number | null)[][]): (string | number | null)[] => {
  if (rows.length === 1) return rows[0]
  return rows.map((row) => row[0])
}

const readCategoriesOrValues = (
  sourceNode: unknown,
  data: SheetDataAccessor,
  warnings: string[]
): (string | number | null)[] => {
  const { cache, ref } = readDataSource(sourceNode)
  if (cache && cache.length > 0) return cache
  if (ref) {
    const rows = safeReadRange(data, ref, warnings)
    if (rows && rows.length > 0) return flattenRange(rows)
    warnings.push(`chart data reference returned no data: ${ref}`)
  }
  return []
}

const parseSeries = (serNode: unknown, data: SheetDataAccessor, warnings: string[]): ChartSeries => {
  const name = readSeriesName(findChild(serNode, 'tx'), data, warnings)

  const catValues = readCategoriesOrValues(findChild(serNode, 'cat'), data, warnings)
  const rawValues = readCategoriesOrValues(findChild(serNode, 'val'), data, warnings)

  const values: (number | null)[] = rawValues.map((v) => (typeof v === 'number' ? v : v === null ? null : Number(v)))
  const normalizedValues = values.map((v) => (v !== null && Number.isNaN(v) ? null : v))

  const categories: (string | number)[] =
    catValues.length > 0 ? catValues.map((c) => (c === null ? '' : c)) : normalizedValues.map((_, i) => i + 1)

  if (catValues.length === 0 && rawValues.length === 0) {
    warnings.push('chart series has no category and value data (cache and reference both empty)')
  }

  return { name, categories, values: normalizedValues }
}

/** plotArea 下第一个受支持的图表类型节点;记录组合图降级 warning */
const pickChartTypeNode = (plotArea: unknown, warnings: string[]): { tag: string; node: unknown } | null => {
  const candidates = entries(plotArea).filter(([name]) => name.endsWith('Chart'))
  if (candidates.length === 0) return null

  const supported = candidates.find(([name]) => name in PLOT_AREA_TYPE_MAP)
  if (candidates.length > 1) {
    warnings.push(
      `combo chart detected (${candidates.map(([n]) => n).join(', ')}); rendering only "${
        (supported ?? candidates[0])[0]
      }"`
    )
  }

  const [tag, node] = supported ?? candidates[0]
  return { tag, node: Array.isArray(node) ? node[0] : node }
}

const parseChartXml = (chartXml: string, data: SheetDataAccessor, warnings: string[]): Omit<ChartModel, 'rect'> => {
  const doc = xmlParser.parse(chartXml)
  const chartSpace = findChild(doc, 'chartSpace')
  const chartNode = findChild(chartSpace, 'chart')
  const plotArea = findChild(chartNode, 'plotArea')

  const picked = pickChartTypeNode(plotArea, warnings)
  const title = parseTitle(chartNode)

  if (!picked) {
    // 找不到任何 c:xxxChart 子节点(如整份 chart XML 损坏/结构不符预期):
    // 视为该图表解析失败,交给调用方 catch 丢弃 + 记录 warning,而不是伪造一个占位图表。
    throw new Error('no chart type node found under plotArea')
  }

  const { tag, node } = picked

  if (!(tag in PLOT_AREA_TYPE_MAP)) {
    return { type: 'unsupported', rawTypeName: tag, title, series: [] }
  }

  const type = PLOT_AREA_TYPE_MAP[tag]

  if (tag === 'pie3DChart' || tag === 'doughnutChart') {
    warnings.push(`${tag} rendered as a regular pie chart`)
  }

  const serNodes = findChildren(node, 'ser')
  const series = serNodes.map((ser) => parseSeries(ser, data, warnings))

  const result: Omit<ChartModel, 'rect'> = { type, title, series }

  if (type === 'bar') {
    const barDir = valAttr(findChild(node, 'barDir'))
    result.barDirection = barDir === 'bar' ? 'bar' : 'col'
  }

  if (type === 'bar' || type === 'line' || type === 'area') {
    const grouping = valAttr(findChild(node, 'grouping'))
    if (grouping === 'stacked' || grouping === 'percentStacked') result.stacked = true
  }

  return result
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function parseCharts(
  zip: JSZip,
  sheetName: string,
  layout: SheetLayoutAccessor,
  data: SheetDataAccessor
): Promise<ParsedCharts> {
  const warnings: string[] = []
  const charts: ChartModel[] = []

  try {
    const sheetPartPath = await resolveSheetPartPath(zip, sheetName)
    if (!sheetPartPath) return { charts, warnings }

    const drawingPartPath = await resolveDrawingPartPath(zip, sheetPartPath)
    if (!drawingPartPath) return { charts, warnings }

    const drawingXml = await readZipText(zip, drawingPartPath)
    if (!drawingXml) return { charts, warnings }

    const drawingDir = drawingPartPath.split('/').slice(0, -1).join('/')
    const drawingFileName = drawingPartPath.split('/').pop() ?? ''
    const drawingRelsXml = await readZipText(zip, `${drawingDir}/_rels/${drawingFileName}.rels`)
    const drawingRels = drawingRelsXml ? parseRelationships(drawingRelsXml) : []

    const anchoredCharts = extractAnchoredCharts(drawingXml, layout)

    for (const anchored of anchoredCharts) {
      try {
        const rel = drawingRels.find((r) => r.id === anchored.chartRId)
        if (!rel) {
          warnings.push(`chart relationship not found: ${anchored.chartRId}`)
          continue
        }
        const chartPartPath = resolveTarget(drawingDir, rel.target)
        const chartXml = await readZipText(zip, chartPartPath)
        if (!chartXml) {
          warnings.push(`chart part missing: ${chartPartPath}`)
          continue
        }
        const parsed = parseChartXml(chartXml, data, warnings)
        charts.push({ ...parsed, rect: anchored.rect })
      } catch (err) {
        warnings.push(`failed to parse chart: ${(err as Error).message}`)
      }
    }
  } catch (err) {
    warnings.push(`failed to parse charts for sheet "${sheetName}": ${(err as Error).message}`)
  }

  return { charts, warnings }
}
