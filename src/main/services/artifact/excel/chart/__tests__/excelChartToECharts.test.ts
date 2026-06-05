import { describe, expect, it } from 'vitest'

import { excelChartToEChartsOption } from '../excelChartToECharts'
import type { ExcelChartKind, ExcelChartRenderModel } from '../excelChartTypes'

const baseModel = (kind: ExcelChartKind): ExcelChartRenderModel => ({
  anchor: {
    from: { column: 0, columnOffset: 0, row: 0, rowOffset: 0 },
    to: { column: 4, columnOffset: 0, row: 10, rowOffset: 0 }
  },
  id: `${kind}-chart`,
  kind,
  series: [
    {
      categories: ['North', 'South'],
      name: 'Amount',
      values: [12, 30]
    }
  ],
  title: 'Sales'
})

const getFirstSeries = (option: NonNullable<ReturnType<typeof excelChartToEChartsOption>>) => {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  return series[0] as Record<string, unknown>
}

describe('excelChartToEChartsOption', () => {
  it('maps column charts to vertical bar options', () => {
    const option = excelChartToEChartsOption(baseModel('column'))

    expect(option).toMatchObject({
      title: { text: 'Sales' },
      xAxis: { data: ['North', 'South'], type: 'category' },
      yAxis: { type: 'value' }
    })
    expect(getFirstSeries(option!)).toMatchObject({ data: [12, 30], name: 'Amount', type: 'bar' })
  })

  it('maps bar charts to horizontal bar options', () => {
    const option = excelChartToEChartsOption(baseModel('bar'))

    expect(option).toMatchObject({
      xAxis: { type: 'value' },
      yAxis: { data: ['North', 'South'], type: 'category' }
    })
    expect(getFirstSeries(option!)).toMatchObject({ type: 'bar' })
  })

  it('maps line and area charts as line series', () => {
    const lineOption = excelChartToEChartsOption(baseModel('line'))
    const areaOption = excelChartToEChartsOption(baseModel('area'))

    expect(getFirstSeries(lineOption!)).toMatchObject({ type: 'line' })
    expect(getFirstSeries(lineOption!).areaStyle).toBeUndefined()
    expect(getFirstSeries(areaOption!)).toMatchObject({ areaStyle: {}, type: 'line' })
  })

  it('maps pie charts to named value slices', () => {
    const option = excelChartToEChartsOption(baseModel('pie'))

    expect(getFirstSeries(option!)).toMatchObject({
      data: [
        { name: 'North', value: 12 },
        { name: 'South', value: 30 }
      ],
      type: 'pie'
    })
  })

  it('maps scatter charts to paired value points', () => {
    const option = excelChartToEChartsOption({
      ...baseModel('scatter'),
      series: [{ name: 'Points', values: [3, 4], xValues: [1, 2], yValues: [3, 4] }]
    })

    expect(option).toMatchObject({
      xAxis: { type: 'value' },
      yAxis: { type: 'value' }
    })
    expect(getFirstSeries(option!)).toMatchObject({
      data: [
        [1, 3],
        [2, 4]
      ],
      type: 'scatter'
    })
  })

  it('returns null for charts without series', () => {
    expect(excelChartToEChartsOption({ ...baseModel('line'), series: [] })).toBeNull()
  })
})
