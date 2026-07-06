import type { EChartsCoreOption } from 'echarts/core'

import type { ChartModel, ChartSeries } from '../renderModel'

/**
 * ChartModel → echarts option 的纯映射函数(可测,不依赖 DOM/echarts 实例)。
 */

/** echarts 用 '-' 表示空值 */
const toEchartsValue = (value: number | null): number | '-' => (value === null ? '-' : value)

const buildCategoryAxisData = (series: ChartSeries[]): (string | number)[] => series[0]?.categories ?? []

/** Excel 100% 堆叠(percentStacked):每个类目按系列合计归一化为百分比;合计为 0 或值缺失 → null */
const normalizePercentStacked = (series: ChartSeries[]): (number | null)[][] => {
  const categoryCount = series.reduce((max, s) => Math.max(max, s.values.length), 0)
  const totals = Array.from({ length: categoryCount }, (_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  return series.map((s) => s.values.map((v, i) => (v === null || totals[i] === 0 ? null : (v / totals[i]) * 100)))
}

const buildBarLineAreaOption = (chart: ChartModel): EChartsCoreOption => {
  const isHorizontal = chart.type === 'bar' && chart.barDirection === 'bar'
  const isPercentStacked = chart.stacking === 'percentStacked'
  const categoryAxis = {
    type: 'category' as const,
    data: buildCategoryAxisData(chart.series)
  }
  const valueAxis = isPercentStacked
    ? { type: 'value' as const, max: 100, axisLabel: { formatter: '{value}%' } }
    : { type: 'value' as const }

  const seriesValues = isPercentStacked ? normalizePercentStacked(chart.series) : chart.series.map((s) => s.values)
  const series = chart.series.map((s, i) => {
    const base = {
      name: s.name,
      data: seriesValues[i].map(toEchartsValue),
      stack: chart.stacking ? 'total' : undefined
    }
    if (chart.type === 'bar') return { ...base, type: 'bar' as const }
    if (chart.type === 'area') return { ...base, type: 'line' as const, areaStyle: {} }
    return { ...base, type: 'line' as const }
  })

  return {
    title: chart.title ? { text: chart.title } : undefined,
    tooltip: { trigger: 'axis' },
    legend: chart.series.length > 1 || chart.series[0]?.name ? {} : undefined,
    grid: { containLabel: true },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series
  }
}

const buildPieOption = (chart: ChartModel): EChartsCoreOption => {
  const first = chart.series[0]
  const data = (first?.categories ?? []).map((name, i) => ({
    name: String(name),
    value: toEchartsValue(first?.values[i] ?? null)
  }))

  return {
    title: chart.title ? { text: chart.title } : undefined,
    tooltip: { trigger: 'item' },
    legend: {},
    series: [
      {
        type: 'pie',
        name: first?.name,
        data
      }
    ]
  }
}

export const buildChartOption = (chart: ChartModel): EChartsCoreOption => {
  if (chart.type === 'pie') return buildPieOption(chart)
  return buildBarLineAreaOption(chart)
}
