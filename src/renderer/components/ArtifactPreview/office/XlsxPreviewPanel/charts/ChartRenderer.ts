import type { ChartModel } from '../renderModel'

/**
 * 图表渲染适配器。
 * 可替换性边界:具体图表库(echarts)的任何类型/概念不得泄漏出实现文件。
 */
export interface ChartRenderer {
  /** 挂载并渲染;返回 dispose。实现内部自行处理容器尺寸变化 */
  render(chart: ChartModel, container: HTMLElement): () => void
}
