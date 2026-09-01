import { BarChart as EchartsBarChart, LineChart as EchartsLineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import type { EChartsCoreOption } from 'echarts/core'
import { use as registerEchartsModules } from 'echarts/core'

import type { CartesianChartProps } from '../types'
import type { ChartTheme } from '../useChartTheme'
import { buildCartesianOption } from './buildCartesianOption'

registerEchartsModules([
  EchartsBarChart,
  EchartsLineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent
])

export function buildCartesianChart(
  props: Omit<CartesianChartProps, 'ariaLabel' | 'className' | 'loading' | 'loadingLabel'>,
  animation: boolean,
  theme: ChartTheme
): EChartsCoreOption {
  const series = props.series.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    name: item.name,
    data: item.values,
    stack: props.stack,
    emphasis: { focus: 'series' as const },
    ...(props.type === 'bar'
      ? {
          type: 'bar' as const,
          barMaxWidth: 32,
          barWidth: props.barWidth
        }
      : {
          type: 'line' as const,
          showSymbol: props.categories.length <= 30,
          symbolSize: 5
        })
  }))

  return buildCartesianOption({
    animation,
    categories: props.categories,
    categoryBoundaryGap: props.type === 'bar',
    horizontal: props.horizontal ?? false,
    option: props.option,
    series: series as NonNullable<EChartsCoreOption['series']>,
    theme,
    visibleCategoryCount: props.visibleCategoryCount
  })
}
