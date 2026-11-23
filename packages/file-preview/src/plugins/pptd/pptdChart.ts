/**
 * Maps PPTD chart elements to ECharts options. Supported series types:
 * bar, line, area, scatter, bubble, pie and candlestick; the reference's
 * exotic types (radar, waterfall, heatmap, treemap, sunburst, sankey)
 * return null so the caller can show the named placeholder.
 */

import type { PptdChart } from './pptdFormat'
import { pptdFontFamilyCss } from './pptdRichText'
import { resolvePptdColor, type PptdStyleContext } from './pptdStyle'

const SUPPORTED_TYPES = new Set(['bar', 'line', 'area', 'scatter', 'bubble', 'pie', 'candlestick'])

interface PptdChartData {
  cols: string[]
  rows: (number | string | null)[][]
}

interface PptdSeriesConfig {
  type: string
  encode?: Record<string, string>
  name?: string
  stack?: 'value' | 'percent'
  smooth?: boolean
  lineStyle?: 'solid' | 'dash' | 'dot'
  width?: number
  nullHandling?: 'zero' | 'gap' | 'connect'
  lineColor?: string | PptdGradientFill
  fill?: string | PptdGradientFill | (string | PptdGradientFill)[]
  innerRadius?: number
  startAngle?: number
  sizeScale?: 'linear' | 'sqrt' | 'log'
  xAxisIndex?: number
  yAxisIndex?: number
  dataLabels?: { content?: string }
}

interface PptdGradientStop {
  position: number
  color: string
}

interface PptdGradientFill {
  type: 'gradient'
  gradientType?: 'linear' | 'radial'
  stops: PptdGradientStop[]
  angle?: number
}

interface EchartsLinearGradient {
  type: 'linear'
  x: number
  y: number
  x2: number
  y2: number
  colorStops: { offset: number; color: string }[]
}

type ColorLike = string | EchartsLinearGradient

/** PPTD linear gradient angle: 0 = left-to-right, clockwise, y down. */
function gradientToEcharts(fill: PptdGradientFill, context: PptdStyleContext): EchartsLinearGradient {
  const angle = ((fill.angle ?? 0) * Math.PI) / 180
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  const cos = Math.cos(angle) / 2
  const sin = Math.sin(angle) / 2
  return {
    type: 'linear',
    x: round(0.5 - cos),
    y: round(0.5 - sin),
    x2: round(0.5 + cos),
    y2: round(0.5 + sin),
    colorStops: fill.stops.map((stop) => ({
      offset: stop.position,
      color: resolvePptdColor(stop.color, context) ?? '#000000'
    }))
  }
}

function colorLike(value: string | PptdGradientFill, context: PptdStyleContext): ColorLike {
  if (typeof value === 'string') return resolvePptdColor(value, context) ?? value
  return gradientToEcharts(value, context)
}

/** Theme color cycle: theme color values in declaration order. */
export function pptdThemeColorCycle(context: PptdStyleContext): string[] {
  const colors = context.theme?.colors ?? {}
  return Object.values(colors).map((color) => resolvePptdColor(color, context) ?? '#4472C4')
}

function dashType(style: 'solid' | 'dash' | 'dot' | undefined): 'dashed' | 'dotted' | undefined {
  return style === 'dash' ? 'dashed' : style === 'dot' ? 'dotted' : undefined
}

function labelOption(content: string | undefined): Record<string, unknown> {
  const formatter = content === 'percentage' ? '{d}%' : content === 'category' ? '{b}' : '{c}'
  return { show: true, formatter }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Option = Record<string, any>

/**
 * Builds the ECharts option for a chart element, or null when the config is
 * unusable or a series type is unsupported (caller shows the placeholder).
 */
export function buildPptdChartOption(element: PptdChart, context: PptdStyleContext): Option | null {
  const raw = element as unknown as {
    data?: PptdChartData
    series?: PptdSeriesConfig[]
    legend?: boolean | Record<string, unknown>
    title?: string | { text?: string }
    dataLabels?: { content?: string }
    fontFamily?: Parameters<typeof pptdFontFamilyCss>[0]
    xAxis?: { type?: 'category' | 'value'; label?: { fontSize?: number; color?: string } } | unknown[]
    yAxis?: { type?: 'category' | 'value'; label?: { fontSize?: number; color?: string } } | unknown[]
    barWidth?: number
    barGap?: number
    categoryGap?: number
  }
  const data = raw.data
  const seriesList = raw.series
  if (
    !data ||
    !Array.isArray(data.cols) ||
    !Array.isArray(data.rows) ||
    !Array.isArray(seriesList) ||
    seriesList.length === 0
  ) {
    return null
  }
  if (seriesList.some((series) => !SUPPORTED_TYPES.has(series.type) || !series.encode)) {
    return null
  }

  const option: Option = {
    dataset: { source: [data.cols, ...data.rows] },
    textStyle: pptdFontFamilyCss(raw.fontFamily) ? { fontFamily: pptdFontFamilyCss(raw.fontFamily) } : undefined
  }
  const cycle = pptdThemeColorCycle(context)
  if (cycle.length > 0) option.color = cycle

  const needsCartesian = seriesList.some((s) => s.type !== 'pie')
  if (needsCartesian) {
    // ECharts defaults an axis without a type to 'value', which gives string
    // categories no valid coordinate. Infer 'category' from the encoded column
    // when the config does not set a type; an explicit type always wins.
    const xColumn = seriesList.find((s) => s.type !== 'pie')?.encode?.x ?? data.cols[0]
    const xIndex = data.cols.indexOf(xColumn ?? '')
    const xIsCategorical = xIndex >= 0 && data.rows.some((row) => typeof row[xIndex] === 'string')
    const mapAxis = (axis: unknown, inferredType?: 'category'): Option => {
      if (Array.isArray(axis)) axis = axis[0]
      const config = (!axis || typeof axis !== 'object' ? {} : axis) as {
        type?: string
        label?: { fontSize?: number; color?: string }
      }
      return {
        type: config.type ?? inferredType,
        axisLabel: config.label
          ? {
              fontSize: config.label.fontSize,
              color: config.label.color ? resolvePptdColor(config.label.color, context) : undefined
            }
          : undefined
      }
    }
    const mapX = (axis: unknown): Option => mapAxis(axis, xIsCategorical ? 'category' : undefined)
    option.xAxis = Array.isArray(raw.xAxis) ? raw.xAxis.map(mapX) : mapX(raw.xAxis)
    option.yAxis = Array.isArray(raw.yAxis) ? raw.yAxis.map((a) => mapAxis(a)) : mapAxis(raw.yAxis)
    option.grid = { containLabel: true, left: 8, right: 8, top: 24, bottom: 8 }
  }

  if (raw.title) {
    option.title = { text: typeof raw.title === 'string' ? raw.title : raw.title.text, left: 'center' }
  }
  const hasPie = seriesList.some((s) => s.type === 'pie')
  option.legend =
    raw.legend === false ? { show: false } : raw.legend ? { show: true } : { show: seriesList.length > 1 || hasPie }

  option.series = seriesList.map((series, index) => {
    const encode = series.encode ?? {}
    const base: Option = {
      name: series.name ?? encode.y ?? encode.value,
      xAxisIndex: series.xAxisIndex,
      yAxisIndex: series.yAxisIndex,
      label:
        (series.dataLabels ?? raw.dataLabels) ? labelOption((series.dataLabels ?? raw.dataLabels)?.content) : undefined
    }
    const fill = Array.isArray(series.fill) ? series.fill[index % series.fill.length] : series.fill
    switch (series.type) {
      case 'bar':
        return {
          ...base,
          type: 'bar',
          encode: { x: encode.x, y: encode.y },
          // Percent stacking approximates to value stacking; normalization is not native to echarts.
          stack: series.stack ? 'pptd-stack' : undefined,
          barWidth: raw.barWidth ? `${raw.barWidth * 100}%` : undefined,
          barGap: raw.barGap !== undefined ? `${raw.barGap * 100}%` : undefined,
          barCategoryGap: raw.categoryGap !== undefined ? `${raw.categoryGap * 100}%` : undefined,
          itemStyle: fill ? { color: colorLike(fill, context) } : undefined
        }
      case 'line':
      case 'area':
        return {
          ...base,
          type: 'line',
          encode: { x: encode.x, y: encode.y },
          smooth: series.smooth,
          connectNulls: series.nullHandling === 'connect' ? true : undefined,
          lineStyle: {
            width: series.width,
            type: dashType(series.lineStyle),
            color: series.lineColor ? colorLike(series.lineColor, context) : undefined
          },
          areaStyle: series.type === 'area' ? (fill ? { color: colorLike(fill, context) } : {}) : undefined
        }
      case 'scatter':
        return {
          ...base,
          type: 'scatter',
          encode: { x: encode.x, y: encode.y },
          itemStyle: fill ? { color: colorLike(fill, context) } : undefined
        }
      case 'bubble': {
        const sizeIndex = data.cols.indexOf(encode.size ?? '')
        const scale = series.sizeScale ?? 'sqrt'
        return {
          ...base,
          type: 'scatter',
          encode: { x: encode.x, y: encode.y },
          symbolSize: (value: unknown[]) => {
            const rawSize = Number(value[sizeIndex])
            if (!Number.isFinite(rawSize) || rawSize <= 0) return 4
            const scaled = scale === 'linear' ? rawSize : scale === 'log' ? Math.log10(rawSize + 1) : Math.sqrt(rawSize)
            return Math.min(Math.max(scaled * 3, 4), 60)
          },
          itemStyle: fill ? { color: colorLike(fill, context) } : undefined
        }
      }
      case 'pie': {
        const sliceFills = Array.isArray(series.fill) ? series.fill : null
        return {
          ...base,
          type: 'pie',
          encode: { itemName: encode.category, value: encode.value },
          radius: [`${(series.innerRadius ?? 0) * 100}%`, '70%'],
          // PPTD startAngle runs clockwise from 12 o'clock; echarts runs counterclockwise from 3 o'clock.
          startAngle: 90 - (series.startAngle ?? 0),
          itemStyle: sliceFills
            ? {
                color: (params: { dataIndex: number }) =>
                  colorLike(sliceFills[params.dataIndex % sliceFills.length], context)
              }
            : fill
              ? { color: colorLike(fill, context) }
              : undefined
        }
      }
      case 'candlestick':
        return {
          ...base,
          type: 'candlestick',
          encode: {
            x: encode.x ?? encode.category,
            open: encode.open,
            close: encode.close,
            low: encode.low,
            high: encode.high
          }
        }
      default:
        return null
    }
  })

  return option
}
