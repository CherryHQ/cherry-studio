import { PieChart as EchartsPieChart } from 'echarts/charts'
import { LegendComponent, TimelineComponent, type TimelineComponentOption, TooltipComponent } from 'echarts/components'
import type { EChartsCoreOption } from 'echarts/core'
import { use as registerEchartsModules } from 'echarts/core'

import type { PieChartDatum, PieChartProps } from '../types'
import type { ChartTheme } from '../useChartTheme'
import { toOptionObject } from './buildCartesianOption'

registerEchartsModules([EchartsPieChart, LegendComponent, TimelineComponent, TooltipComponent])

function buildSeries(data: PieChartDatum[], hasLegend: boolean, hasTimeline: boolean, theme: ChartTheme) {
  return {
    id: 'distribution',
    type: 'pie' as const,
    radius: hasLegend ? (hasTimeline ? ['32%', '56%'] : ['38%', '64%']) : ['48%', '72%'],
    center: hasTimeline ? ['50%', '37%'] : hasLegend ? ['50%', '43%'] : ['50%', '50%'],
    minAngle: 1,
    avoidLabelOverlap: true,
    label: { show: false },
    emphasis: { scale: true, scaleSize: 6 },
    itemStyle: {
      borderColor: theme.background,
      borderRadius: 2,
      borderWidth: 1
    },
    data
  }
}

export function buildPieChart(
  props: Omit<PieChartProps, 'ariaLabel' | 'className' | 'loading' | 'loadingLabel' | 'type'>,
  animation: boolean,
  theme: ChartTheme
): EChartsCoreOption {
  const option = props.option ?? {}
  const tooltip = toOptionObject(option.tooltip)
  const legend = option.legend
  const frames = props.timeline?.frames ?? []
  const hasTimeline = frames.length > 1
  const timeline: TimelineComponentOption | undefined = hasTimeline
    ? {
        axisType: 'category',
        autoPlay: false,
        loop: false,
        replaceMerge: ['series'],
        currentIndex: props.timeline?.currentIndex ?? frames.length - 1,
        left: 20,
        right: 20,
        bottom: 0,
        height: 32,
        symbol: 'none',
        data: frames.map((frame) => frame.label),
        lineStyle: { color: theme.border },
        itemStyle: { color: theme.mutedForeground },
        checkpointStyle: {
          color: theme.colors[0] ?? theme.mutedForeground,
          borderColor: theme.background,
          borderWidth: 2,
          symbolSize: 10
        },
        controlStyle: {
          showPlayBtn: false,
          itemSize: 14,
          color: theme.mutedForeground,
          borderColor: theme.mutedForeground
        },
        label: {
          color: theme.foregroundTertiary,
          fontSize: 10,
          interval: 'auto',
          position: 'bottom'
        },
        progress: {
          lineStyle: { color: theme.mutedForeground },
          itemStyle: { color: theme.mutedForeground },
          label: { color: theme.mutedForeground }
        }
      }
    : undefined
  const baseOption: EChartsCoreOption = {
    ...option,
    animation,
    color: theme.colors,
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: theme.popover,
      borderColor: theme.border,
      ...tooltip,
      textStyle: {
        color: theme.popoverForeground,
        ...toOptionObject(tooltip.textStyle)
      }
    },
    legend: legend
      ? {
          type: 'scroll',
          left: 'center',
          bottom: hasTimeline ? 46 : 0,
          icon: 'circle',
          itemWidth: 8,
          itemHeight: 8,
          itemGap: 16,
          formatter: legend.formatter,
          textStyle: { color: theme.mutedForeground },
          pageIconColor: theme.mutedForeground,
          pageIconInactiveColor: theme.border,
          pageTextStyle: { color: theme.foregroundTertiary }
        }
      : undefined,
    timeline,
    series: [buildSeries(props.data, Boolean(legend), hasTimeline, theme)]
  }

  if (!hasTimeline) return baseOption

  return {
    baseOption,
    options: frames.map((frame) => ({
      series: [{ id: 'distribution', type: 'pie', data: frame.data }]
    }))
  }
}
