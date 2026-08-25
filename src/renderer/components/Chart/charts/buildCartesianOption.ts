import type { EChartsCoreOption } from 'echarts/core'

import type { CartesianChartOptionExtension } from '../types'
import type { ChartTheme } from '../useChartTheme'

type OptionObject = Record<string, unknown>

export function toOptionObject(value: unknown): OptionObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as OptionObject
}

function mergeAxis(base: OptionObject, extension: OptionObject, data?: Array<number | string>): OptionObject {
  const baseAxisLine = toOptionObject(base.axisLine)
  const extensionAxisLine = toOptionObject(extension.axisLine)
  const baseAxisLabel = toOptionObject(base.axisLabel)
  const extensionAxisLabel = toOptionObject(extension.axisLabel)
  const baseAxisPointer = toOptionObject(base.axisPointer)
  const extensionAxisPointer = toOptionObject(extension.axisPointer)

  return {
    ...base,
    ...extension,
    ...(data ? { data } : {}),
    axisLine: {
      ...baseAxisLine,
      ...extensionAxisLine,
      lineStyle: {
        ...toOptionObject(baseAxisLine.lineStyle),
        ...toOptionObject(extensionAxisLine.lineStyle)
      }
    },
    axisLabel: { ...baseAxisLabel, ...extensionAxisLabel },
    axisPointer: {
      ...baseAxisPointer,
      ...extensionAxisPointer,
      lineStyle: {
        ...toOptionObject(baseAxisPointer.lineStyle),
        ...toOptionObject(extensionAxisPointer.lineStyle)
      },
      shadowStyle: {
        ...toOptionObject(baseAxisPointer.shadowStyle),
        ...toOptionObject(extensionAxisPointer.shadowStyle)
      }
    }
  }
}

export function buildCartesianOption({
  animation,
  categories,
  categoryBoundaryGap,
  horizontal,
  option = {},
  series,
  theme,
  visibleCategoryCount
}: {
  animation: boolean
  categories: Array<number | string>
  categoryBoundaryGap: boolean
  horizontal: boolean
  option?: CartesianChartOptionExtension
  series: NonNullable<EChartsCoreOption['series']>
  theme: ChartTheme
  visibleCategoryCount?: number
}): EChartsCoreOption {
  const categoryAxis = mergeAxis(
    {
      type: 'category',
      boundaryGap: categoryBoundaryGap,
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { color: theme.foregroundTertiary, hideOverlap: true, margin: 12 },
      axisPointer: {
        lineStyle: { color: theme.mutedForeground },
        shadowStyle: { color: theme.muted }
      }
    },
    toOptionObject(horizontal ? option.yAxis : option.xAxis),
    categories
  )
  const valueAxis = mergeAxis(
    {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.foregroundTertiary },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } }
    },
    toOptionObject(horizontal ? option.xAxis : option.yAxis)
  )
  const tooltip = toOptionObject(option.tooltip)
  const legend = option.legend
  const hasDataZoom = visibleCategoryCount !== undefined && categories.length > visibleCategoryCount
  const zoomStart = hasDataZoom ? Math.max(0, 100 - (visibleCategoryCount / categories.length) * 100) : 0

  return {
    ...option,
    animation,
    color: theme.colors,
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: theme.popover,
      borderColor: theme.border,
      ...tooltip,
      textStyle: {
        color: theme.popoverForeground,
        ...toOptionObject(tooltip.textStyle)
      }
    },
    grid: {
      top: 12,
      right: 12,
      bottom: hasDataZoom ? (legend ? 84 : 52) : legend ? 52 : 16,
      left: 12,
      containLabel: true,
      ...toOptionObject(option.grid)
    },
    legend: legend
      ? {
          type: 'scroll',
          left: 'center',
          bottom: 0,
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
    dataZoom: hasDataZoom
      ? [
          {
            type: 'inside',
            ...(horizontal ? { yAxisIndex: [0] } : { xAxisIndex: [0] }),
            start: zoomStart,
            end: 100
          },
          {
            type: 'slider',
            ...(horizontal ? { yAxisIndex: [0] } : { xAxisIndex: [0] }),
            start: zoomStart,
            end: 100,
            bottom: legend ? 40 : 0,
            height: 18,
            borderColor: theme.border,
            fillerColor: theme.muted,
            backgroundColor: theme.background,
            dataBackground: {
              lineStyle: { color: theme.mutedForeground },
              areaStyle: { color: theme.muted }
            },
            selectedDataBackground: {
              lineStyle: { color: theme.mutedForeground },
              areaStyle: { color: theme.mutedForeground }
            },
            handleStyle: { color: theme.popover, borderColor: theme.mutedForeground },
            textStyle: { color: theme.foregroundTertiary }
          }
        ]
      : undefined,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series
  }
}
