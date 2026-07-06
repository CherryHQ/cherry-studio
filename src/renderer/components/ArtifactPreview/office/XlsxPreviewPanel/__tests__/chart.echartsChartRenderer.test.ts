import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChartModel } from '../renderModel'

/**
 * EchartsChartRenderer 生命周期测试。
 *
 * jsdom 下没有 `canvas` npm 包时,echarts 的 CanvasRenderer 无法真正创建 2D 上下文
 * (HTMLCanvasElement.getContext('2d') 在 jsdom 里抛 "Not implemented"),这是环境限制,
 * 不是本包的 bug。按 04-wp-charts.md 的预案,这里用 vi.mock 替身验证渲染适配器自身的接线逻辑
 * (init/setOption 调用、ResizeObserver 首次有尺寸时的处理、dispose 清理),
 * ChartModel → option 的实际映射由 chart.buildChartOption.test.ts 覆盖。
 */

const setOption = vi.fn()
const resize = vi.fn()
const dispose = vi.fn()
const init = vi.fn((dom: HTMLElement, theme?: unknown, opts?: unknown) => {
  void dom
  void theme
  void opts
  return { setOption, resize, dispose }
})

vi.mock('echarts/core', () => ({
  init,
  use: vi.fn()
}))
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  TitleComponent: {}
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

let resizeObserverInstances: {
  callback: ResizeObserverCallback
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}[] = []

class FakeResizeObserver {
  callback: ResizeObserverCallback
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObserverInstances.push(this as any)
  }
  unobserve = vi.fn()
}

const chart: ChartModel = {
  rect: { x: 0, y: 0, width: 100, height: 100 },
  type: 'bar',
  barDirection: 'col',
  series: [{ categories: ['a'], values: [1] }]
}

describe('echartsChartRenderer.render', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    resizeObserverInstances = []
    setOption.mockClear()
    resize.mockClear()
    dispose.mockClear()
    init.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes an echarts instance on the container and sets the mapped option', async () => {
    const { echartsChartRenderer } = await import('../charts/EchartsChartRenderer')
    const container = document.createElement('div')

    const dispose1 = echartsChartRenderer.render(chart, container)

    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][0]).toBe(container)
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(setOption.mock.calls[0][0]).toMatchObject({ series: [expect.objectContaining({ type: 'bar' })] })

    dispose1()
  })

  it('observes the container for resize and re-applies the option + resizes once it first gets a nonzero size', async () => {
    const { echartsChartRenderer } = await import('../charts/EchartsChartRenderer')
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 0, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 0, configurable: true })

    const disposeFn = echartsChartRenderer.render(chart, container)
    expect(resizeObserverInstances).toHaveLength(1)
    const observer = resizeObserverInstances[0]
    expect(observer.observe).toHaveBeenCalledWith(container)

    setOption.mockClear()

    // Still zero-size: resize callback should be a no-op.
    observer.callback([] as any, observer as any)
    expect(setOption).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()

    // Container gains a real size: should re-apply option once and call resize.
    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true })
    observer.callback([] as any, observer as any)
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(resize).toHaveBeenCalledTimes(1)

    // Subsequent resize events should just resize, not re-apply the option again.
    setOption.mockClear()
    observer.callback([] as any, observer as any)
    expect(setOption).not.toHaveBeenCalled()
    expect(resize).toHaveBeenCalledTimes(2)

    disposeFn()
  })

  it('dispose() disconnects the resize observer and disposes the echarts instance', async () => {
    const { echartsChartRenderer } = await import('../charts/EchartsChartRenderer')
    const container = document.createElement('div')

    const disposeFn = echartsChartRenderer.render(chart, container)
    const observer = resizeObserverInstances[0]

    disposeFn()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
