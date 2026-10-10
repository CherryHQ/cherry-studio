import type { EChartsCoreOption } from 'echarts/core'
import { describe, expect, it } from 'vitest'

import type { ChartTheme } from '../../useChartTheme'
import { buildCartesianOption } from '../buildCartesianOption'

const THEME: ChartTheme = {
  background: '#background',
  border: '#border',
  colors: ['#chart-1'],
  foregroundTertiary: '#foreground-tertiary',
  muted: '#muted',
  mutedForeground: '#muted-foreground',
  popover: '#popover',
  popoverForeground: '#popover-foreground'
}

const SERIES = [{ type: 'bar', data: [1] }] as NonNullable<EChartsCoreOption['series']>

describe('buildCartesianOption', () => {
  it('merges the supported tooltip, grid, and axis extensions into themed defaults', () => {
    const valueFormatter = (value: unknown) => String(value)
    const axisFormatter = (value: number) => String(value)

    const option = buildCartesianOption({
      animation: false,
      categories: ['Jan'],
      categoryBoundaryGap: true,
      horizontal: false,
      option: {
        tooltip: { valueFormatter },
        grid: { top: 8 },
        xAxis: { axisPointer: { type: 'shadow' } },
        yAxis: { minInterval: 1, axisLabel: { formatter: axisFormatter } }
      },
      series: SERIES,
      theme: THEME
    })

    expect(option).toMatchObject({
      grid: { top: 8, right: 12, bottom: 16, left: 12, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter,
        backgroundColor: THEME.popover,
        borderColor: THEME.border
      },
      xAxis: {
        type: 'category',
        data: ['Jan'],
        axisPointer: { type: 'shadow', lineStyle: { color: THEME.mutedForeground } }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: THEME.foregroundTertiary, formatter: axisFormatter }
      }
    })
  })

  it('applies x-axis extensions to the value axis when the chart is horizontal', () => {
    const option = buildCartesianOption({
      animation: false,
      categories: ['Model'],
      categoryBoundaryGap: true,
      horizontal: true,
      option: {
        xAxis: { minInterval: 1 },
        yAxis: { axisLabel: { show: false } }
      },
      series: SERIES,
      theme: THEME
    })

    expect(option).toMatchObject({
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: ['Model'], axisLabel: { show: false } }
    })
  })

  it('uses a native scroll legend and reserves chart space for it', () => {
    const formatter = (name: string) => `${name} total`
    const option = buildCartesianOption({
      animation: false,
      categories: ['Jan'],
      categoryBoundaryGap: true,
      horizontal: false,
      option: { legend: { formatter } },
      series: SERIES,
      theme: THEME
    })

    expect(option).toMatchObject({
      grid: { bottom: 52 },
      legend: {
        type: 'scroll',
        left: 'center',
        bottom: 0,
        formatter,
        textStyle: { color: THEME.mutedForeground },
        pageIconColor: THEME.mutedForeground,
        pageIconInactiveColor: THEME.border
      }
    })
  })

  it('delegates long-range navigation to echarts while reserving legend space', () => {
    const option = buildCartesianOption({
      animation: false,
      categories: Array.from({ length: 40 }, (_, index) => index),
      categoryBoundaryGap: true,
      horizontal: false,
      option: { legend: {} },
      series: SERIES,
      theme: THEME,
      visibleCategoryCount: 10
    })

    expect(option).toMatchObject({
      grid: { top: 12, bottom: 84 },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0], start: 75, end: 100 },
        { type: 'slider', xAxisIndex: [0], start: 75, end: 100, bottom: 40 }
      ]
    })
  })
})
