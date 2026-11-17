import { describe, expect, it } from 'vitest'

import { buildChartOption } from '../charts/buildChartOption'
import type { ChartModel } from '../renderModel'

/**
 * Tests the pure ChartModel -> echarts option mapping. See 04-wp-charts.md Part 2 for the mapping rules.
 * It does not depend on DOM or echarts instances, so it is the main mapping test path when jsdom lacks canvas.
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

  it('sets series.stack when chart.stacking is set, and leaves it unset otherwise', () => {
    const stacked: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacking: 'stacked',
      series: [
        { name: 'A', categories: ['x'], values: [1] },
        { name: 'B', categories: ['x'], values: [2] }
      ]
    }
    const stackedOption = buildChartOption(stacked) as any
    expect(stackedOption.series[0].stack).toBe('total')
    expect(stackedOption.series[1].stack).toBe('total')
    // Regular stacking keeps raw values without normalization.
    expect(stackedOption.series[0].data).toEqual([1])
    expect(stackedOption.yAxis.max).toBeUndefined()

    const unstacked: ChartModel = { ...stacked, stacking: undefined }
    const unstackedOption = buildChartOption(unstacked) as any
    expect(unstackedOption.series[0].stack).toBeUndefined()
  })

  it('normalizes percentStacked values per category and caps the value axis at 100%', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacking: 'percentStacked',
      series: [
        { name: 'A', categories: ['x', 'y'], values: [10, 30] },
        { name: 'B', categories: ['x', 'y'], values: [30, 10] }
      ]
    }
    const option = buildChartOption(chart) as any

    expect(option.series[0].data).toEqual([25, 75])
    expect(option.series[1].data).toEqual([75, 25])
    expect(option.series[0].stack).toBe('total')
    expect(option.yAxis.max).toBe(100)
    expect(option.yAxis.axisLabel.formatter).toBe('{value}%')
  })

  it('percentStacked maps null values and zero-total categories to the gap marker', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacking: 'percentStacked',
      series: [
        { name: 'A', categories: ['x', 'y', 'z'], values: [null, 0, 5] },
        { name: 'B', categories: ['x', 'y', 'z'], values: [4, 0, 15] }
      ]
    }
    const option = buildChartOption(chart) as any

    // x:A is missing -> '-'; y total is 0 -> cannot normalize -> '-'; z normalizes normally.
    expect(option.series[0].data).toEqual(['-', '-', 25])
    expect(option.series[1].data).toEqual([100, '-', 75])
  })

  it('downgrades percentStacked with all-negative categories to plain stacking of raw values', () => {
    // Signed-total normalization would flip -30/-70 into +30%/+70%; the downgrade keeps the raw negative values.
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacking: 'percentStacked',
      series: [
        { name: 'A', categories: ['x'], values: [-30] },
        { name: 'B', categories: ['x'], values: [-70] }
      ]
    }
    const option = buildChartOption(chart) as any

    expect(option.series[0].data).toEqual([-30])
    expect(option.series[1].data).toEqual([-70])
    expect(option.series[0].stack).toBe('total')
    expect(option.yAxis.max).toBeUndefined()
    expect(option.yAxis.axisLabel).toBeUndefined()
  })

  it('downgrades percentStacked with mixed-sign categories instead of exceeding the 100% axis', () => {
    // 80/-20 normalizes to 133%/-33% against the signed total 60 and clips at max 100; raw values do not.
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      stacking: 'percentStacked',
      series: [
        { name: 'A', categories: ['x'], values: [80] },
        { name: 'B', categories: ['x'], values: [-20] }
      ]
    }
    const option = buildChartOption(chart) as any

    expect(option.series[0].data).toEqual([80])
    expect(option.series[1].data).toEqual([-20])
    expect(option.yAxis.max).toBeUndefined()
  })

  it('percentStacked puts the percent axis on x for horizontal bars', () => {
    const chart: ChartModel = {
      rect: baseRect,
      type: 'bar',
      barDirection: 'bar',
      stacking: 'percentStacked',
      series: [{ name: 'A', categories: ['x'], values: [5] }]
    }
    const option = buildChartOption(chart) as any

    expect(option.xAxis.max).toBe(100)
    expect(option.yAxis.type).toBe('category')
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
