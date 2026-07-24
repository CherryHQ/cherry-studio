import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

import type { ChartModel } from '../renderModel'
import { buildChartOption } from './buildChartOption'
import type { ChartRenderer } from './ChartRenderer'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer
])

/**
 * echarts implementation. Import echarts/core plus per-chart modules on demand; do not use a full import.
 * This file is lazy-loaded by the panel and must not be statically referenced by the main bundle.
 */
export const echartsChartRenderer: ChartRenderer = {
  render(chart: ChartModel, container: HTMLElement): () => void {
    const instance = echarts.init(container, undefined, { renderer: 'canvas' })
    instance.setOption(buildChartOption(chart))

    let hasSized = container.clientWidth > 0 && container.clientHeight > 0

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      if (!hasSized) {
        hasSized = true
        instance.setOption(buildChartOption(chart))
      }
      instance.resize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      instance.dispose()
    }
  }
}
