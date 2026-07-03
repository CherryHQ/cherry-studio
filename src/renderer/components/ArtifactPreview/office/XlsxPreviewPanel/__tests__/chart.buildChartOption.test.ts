import { describe, expect, it } from 'vitest'

import { buildChartOption } from '../charts/buildChartOption'
import type { ChartModel } from '../renderModel'

/**
 * ChartModel → echarts option 纯函数映射测试。见 04-wp-charts.md Part 2 映射规则。
 * 不依赖 DOM/echarts 实例,可在任意环境下运行(jsdom 缺 canvas 时这是验证映射逻辑的主路径)。
 */

const baseRect = { x: 0, y: 0, width: 100, height: 100 }

describe('buildChartOption — bar/line/area (category axis)', () => {
  it('maps a column bar chart to a category x-axis + bar series', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      barDirection: 'col',
      title: 'Sales',
      series: [{ name: 'Q', categories: ['Q1', 'Q2'], values: [10, 20] }]
    }
    const option = buildChartOption(chart) as any

    expect(option.title.text).toBe('Sales')
    expect(option.xAxis.type).toBe('category')
    expect(option.xAxis.data).toEqual(['Q1', 'Q2'])
    expect(option.yAxis.type).toBe('value')
    expect(option.series).toHaveLength(1)
    expect(option.series[0].type).toBe('bar')
    expect(option.series[0].name).toBe('Q')
    expect(option.series[0].data).toEqual([10, 20])
  })

  it('swaps x/y axes for a horizontal bar chart (barDirection === "bar")', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      barDirection: 'bar',
      series: [{ categories: ['A', 'B'], values: [1, 2] }]
    }
    const option = buildChartOption(chart) as any

    expect(option.xAxis.type).toBe('value')
    expect(option.yAxis.type).toBe('category')
    expect(option.yAxis.data).toEqual(['A', 'B'])
  })

  it('sets series.stack when chart.stacked is true, and leaves it unset otherwise', () => {
    const stacked: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacked: true,
      series: [
        { name: 'A', categories: ['x'], values: [1] },
        { name: 'B', categories: ['x'], values: [2] }
      ]
    }
    const stackedOption = buildChartOption(stacked) as any
    expect(stackedOption.series[0].stack).toBe('total')
    expect(stackedOption.series[1].stack).toBe('total')

    const unstacked: ChartModel = { ...stacked, stacked: undefined }
    const unstackedOption = buildChartOption(unstacked) as any
    expect(unstackedOption.series[0].stack).toBeUndefined()
  })

  it('maps a line chart to type "line" without areaStyle', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'line',
      series: [{ categories: ['a'], values: [1] }]
    }
    const option = buildChartOption(chart) as any
    expect(option.series[0].type).toBe('line')
    expect(option.series[0].areaStyle).toBeUndefined()
  })

  it('maps an area chart to echarts line type with areaStyle set', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'area',
      series: [{ categories: ['a'], values: [1] }]
    }
    const option = buildChartOption(chart) as any
    expect(option.series[0].type).toBe('line')
    expect(option.series[0].areaStyle).toEqual({})
  })

  it('maps null values to the echarts "-" gap marker', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'line',
      series: [{ categories: ['a', 'b'], values: [1, null] }]
    }
    const option = buildChartOption(chart) as any
    expect(option.series[0].data).toEqual([1, '-'])
  })

  it('omits the title when chart.title is undefined', () => {
    const chart: ChartModel = { rect: baseRect, type: 'line', series: [{ categories: [], values: [] }] }
    const option = buildChartOption(chart) as any
    expect(option.title).toBeUndefined()
  })
})

describe('buildChartOption — pie', () => {
  it('maps the first series categories/values to name/value pairs', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'pie',
      title: 'Share',
      series: [
        { name: 'Revenue', categories: ['A', 'B', 'C'], values: [10, 20, null] },
        { name: 'Ignored second series', categories: ['X'], values: [999] }
      ]
    }
    const option = buildChartOption(chart) as any

    expect(option.title.text).toBe('Share')
    expect(option.series).toHaveLength(1)
    expect(option.series[0].type).toBe('pie')
    expect(option.series[0].name).toBe('Revenue')
    expect(option.series[0].data).toEqual([
      { name: 'A', value: 10 },
      { name: 'B', value: 20 },
      { name: 'C', value: '-' }
    ])
  })

  it('produces an empty data array when there are no series', () => {
    const chart: ChartModel = { rect: baseRect, type: 'pie', series: [] }
    const option = buildChartOption(chart) as any
    expect(option.series[0].data).toEqual([])
  })
})
