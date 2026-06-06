import type { EChartsOption } from 'echarts'

import type { ExcelChartRenderModel, ExcelChartSeries } from './excelChartTypes'

const CHART_COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']

const toSeriesName = (series: ExcelChartSeries, index: number): string => series.name || `Series ${index + 1}`

const toCategoryLabels = (series: ExcelChartSeries): string[] => {
  return (series.categories ?? series.values.map((_, index) => String(index + 1))).map(String)
}

const toGridOption = () => ({
  bottom: 36,
  containLabel: true,
  left: 42,
  right: 24,
  top: 48
})

export const excelChartToEChartsOption = (model: ExcelChartRenderModel): EChartsOption | null => {
  if (!model.series.length) return null

  const title = model.title
    ? { left: 'center', text: model.title, textStyle: { fontSize: 14, fontWeight: 'normal' as const } }
    : undefined
  const base = {
    animation: false,
    color: CHART_COLORS,
    legend: model.series.length > 1 ? { bottom: 0, type: 'plain' as const } : undefined,
    title
  }

  if (model.kind === 'pie') {
    const series = model.series[0]
    const categories = toCategoryLabels(series)

    return {
      ...base,
      series: [
        {
          data: series.values.map((value, index) => ({
            name: categories[index] ?? String(index + 1),
            value
          })),
          name: toSeriesName(series, 0),
          radius: '62%',
          type: 'pie'
        }
      ],
      tooltip: { show: false }
    }
  }

  if (model.kind === 'scatter') {
    return {
      ...base,
      grid: toGridOption(),
      series: model.series.map((series, index) => ({
        data: (series.xValues ?? []).map((x, pointIndex) => [
          x,
          series.yValues?.[pointIndex] ?? series.values[pointIndex]
        ]),
        name: toSeriesName(series, index),
        symbolSize: 8,
        type: 'scatter'
      })),
      tooltip: { show: false },
      xAxis: { type: 'value' },
      yAxis: { type: 'value' }
    }
  }

  const categories = toCategoryLabels(model.series[0])
  const isHorizontalBar = model.kind === 'bar'
  const axisCategory = { data: categories, type: 'category' as const }
  const axisValue = { type: 'value' as const }
  const series = model.series.map((item, index) => ({
    areaStyle: model.kind === 'area' ? {} : undefined,
    data: item.values,
    name: toSeriesName(item, index),
    type: model.kind === 'area' ? ('line' as const) : model.kind === 'column' ? ('bar' as const) : model.kind
  }))

  return {
    ...base,
    grid: toGridOption(),
    series,
    tooltip: { show: false },
    xAxis: isHorizontalBar ? axisValue : axisCategory,
    yAxis: isHorizontalBar ? axisCategory : axisValue
  }
}
