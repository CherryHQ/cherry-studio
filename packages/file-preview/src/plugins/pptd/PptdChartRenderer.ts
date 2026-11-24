import { BarChart, CandlestickChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { DatasetComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

import { buildPptdChartOption } from './pptdChart'
import type { PptdChart } from './pptdFormat'
import type { PptdStyleContext } from './pptdStyle'

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  PieChart,
  CandlestickChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer
])

/**
 * echarts renderer for PPTD chart elements. Follows the spreadsheet plugin's
 * pattern: modular imports, and this module must stay lazy-loaded so echarts
 * never enters the main bundle.
 */
export function renderPptdChart(element: PptdChart, context: PptdStyleContext, container: HTMLElement): () => void {
  const option = buildPptdChartOption(element, context)
  if (!option) return () => {}
  const instance = echarts.init(container, undefined, { renderer: 'canvas' })
  instance.setOption(option)

  let hasSized = container.clientWidth > 0 && container.clientHeight > 0
  const resizeObserver = new ResizeObserver(() => {
    if (container.clientWidth === 0 || container.clientHeight === 0) return
    if (!hasSized) {
      hasSized = true
      instance.setOption(option)
    }
    instance.resize()
  })
  resizeObserver.observe(container)

  return () => {
    resizeObserver.disconnect()
    instance.dispose()
  }
}
