import { useReducedMotion } from 'motion/react'

import { buildCartesianChart } from './charts/buildCartesianChart'
import { buildPieChart } from './charts/buildPieChart'
import { Echarts } from './runtime/Echarts'
import type { ChartProps } from './types'
import { useChartTheme } from './useChartTheme'

export function Chart(props: ChartProps) {
  const theme = useChartTheme()
  const animation = !useReducedMotion()
  const option =
    props.type === 'pie' ? buildPieChart(props, animation, theme) : buildCartesianChart(props, animation, theme)

  return (
    <Echarts
      ariaLabel={props.ariaLabel}
      className={props.className}
      loading={props.loading}
      loadingColor={theme.colors[0] ?? theme.mutedForeground}
      loadingLabel={props.loadingLabel}
      loadingTextColor={theme.mutedForeground}
      option={option}
    />
  )
}
