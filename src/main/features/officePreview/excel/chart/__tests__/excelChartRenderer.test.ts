import { describe, expect, it } from 'vitest'

import { getExcelChartRenderSize } from '../excelChartRenderer'
import type { ExcelChartRenderModel } from '../excelChartTypes'

const baseModel: ExcelChartRenderModel = {
  anchor: {
    from: { column: 4, columnOffset: 0, row: 4, rowOffset: 0 },
    to: { column: 2, columnOffset: 0, row: 2, rowOffset: 0 }
  },
  id: 'chart-1',
  kind: 'line',
  series: [{ values: [1, 2] }]
}

describe('getExcelChartRenderSize', () => {
  it('uses default dimensions when anchor dimensions are not positive', () => {
    expect(getExcelChartRenderSize(baseModel)).toEqual({ height: 280, width: 480 })
  })
})
