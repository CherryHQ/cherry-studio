import type { EChartsCoreOption } from 'echarts/core'

import type { ChartModel, ChartSeries } from '../renderModel'

/**
 * ChartModel → echarts option 的纯映射函数(可测,不依赖 DOM/echarts 实例)。
 * 见 .context/xlsx-preview/04-wp-charts.md Part 2 映射规则。
 */

/** echarts 用 '-' 表示空值 */
const toEchartsValue = (value: number | null): number | '-' => (value === null ? '-' : value)

const buildCategoryAxisData = (series: ChartSeries[]): (string | number)[] => series[0]?.categories ?? []

const buildBarLineAreaOption = (chart: ChartModel): EChartsCoreOption => {
  const isHorizontal = chart.type === 'bar' && chart.barDirection === 'bar'
  const categoryAxis = {
    type: 'category' as const,
    data: buildCategoryAxisData(chart.series)
  }
  const valueAxis = { type: 'value' as const }

  const series = chart.series.map((s) => {
    const base = {
      name: s.name,
      data: s.values.map(toEchartsValue),
      stack: chart.stacked ? 'total' : undefined
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
