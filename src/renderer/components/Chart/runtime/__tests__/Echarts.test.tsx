import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { act, cleanup, render } from '@testing-library/react'
import { BarChart, PieChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TimelineComponent,
  type TimelineComponentOption
} from 'echarts/components'
import type { EChartsCoreOption } from 'echarts/core'
import * as echarts from 'echarts/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageCaptureEvent } from '@renderer/utils/image'

import { Chart } from '../../Chart'
import type { PieChartProps } from '../../types'
import { Echarts } from '../Echarts'

const instance = vi.hoisted(() => ({
  dispose: vi.fn(),
  hideLoading: vi.fn(),
  resize: vi.fn(),
  showLoading: vi.fn(),
  setOption: vi.fn()
}))

echarts.use([BarChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TimelineComponent])
echarts.registerPostInit((chart) => {
  for (const method of ['dispose', 'hideLoading', 'resize', 'showLoading', 'setOption'] as const) {
    instance[method] = vi.spyOn(chart, method)
  }
})
// The preserved legacy bar fixtures omit axes; supply them through the real preprocessing API.
echarts.registerPreprocessor((option) => {
  if (Array.isArray(option.series) && option.series.some((series) => series.type === 'bar')) {
    option.xAxis ??= { type: 'category' }
    option.yAxis ??= {}
  }
})
let width = 640
let resize: () => void

beforeEach(() => {
  width = 640
  vi.spyOn(HTMLDivElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLDivElement.prototype, 'clientHeight', 'get').mockReturnValue(320)
  const canvases = new WeakMap<HTMLCanvasElement, Canvas>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let canvas = canvases.get(this)
    if (!canvas) {
      canvas = createCanvas(this.width || 1, this.height || 1)
      canvases.set(this, canvas)
    }
    if (canvas.width !== this.width) canvas.width = this.width || 1
    if (canvas.height !== this.height) canvas.height = this.height || 1
    return canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(function ResizeObserverMock(callback: () => void) {
    resize = callback
    return { disconnect: vi.fn(), observe: vi.fn() }
  })
)

describe('Echarts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the current option while loading and applies the next option when loading finishes', () => {
    const initialOption = { series: [{ type: 'bar', data: [1] }] } satisfies EChartsCoreOption
    const nextOption = { series: [{ type: 'bar', data: [2] }] } satisfies EChartsCoreOption
    const view = render(
      <Echarts
        ariaLabel="Usage"
        loading={false}
        loadingColor="#000"
        loadingLabel="Loading"
        loadingTextColor="#111"
        option={initialOption}
      />
    )

    expect(instance.setOption).toHaveBeenCalledTimes(1)
    expect(instance.setOption).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        replaceMerge: expect.arrayContaining(['series', 'dataZoom', 'timeline', 'grid', 'xAxis', 'yAxis', 'legend'])
      })
    )

    view.rerender(
      <Echarts
        ariaLabel="Usage"
        loading
        loadingColor="#000"
        loadingLabel="Loading"
        loadingTextColor="#111"
        option={nextOption}
      />
    )

    expect(instance.setOption).toHaveBeenCalledTimes(1)
    expect(instance.showLoading).toHaveBeenLastCalledWith('default', expect.any(Object))

    view.rerender(
      <Echarts
        ariaLabel="Usage"
        loading={false}
        loadingColor="#000"
        loadingLabel="Loading"
        loadingTextColor="#111"
        option={nextOption}
      />
    )

    expect(instance.setOption).toHaveBeenCalledTimes(2)
    expect(instance.hideLoading).toHaveBeenCalled()
  })

  it('keeps base components when applying a timeline frame', () => {
    const timeline: TimelineComponentOption = { data: ['Jul 27', 'Jul 28'] }
    const option: EChartsCoreOption = {
      baseOption: {
        legend: {},
        timeline,
        series: [{ type: 'pie', data: [{ name: 'Model A', value: 10 }] }]
      },
      options: [{ series: [{ type: 'pie', data: [{ name: 'Model A', value: 10 }] }] }]
    }

    render(
      <Echarts
        ariaLabel="Usage"
        loading={false}
        loadingColor="#000"
        loadingLabel="Loading"
        loadingTextColor="#111"
        option={option}
      />
    )

    expect(instance.setOption).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        replaceMerge: expect.not.arrayContaining(['legend', 'timeline'])
      })
    )
  })
})

describe('Chart timeline selection', () => {
  it('preserves the selected frame for equal prop values and applies changed data', async () => {
    vi.useFakeTimers()
    const frames = [10, 20, 30].map((value, index) => ({
      label: `Day ${index + 1}`,
      data: [{ name: 'Model A', value }]
    }))
    const props: PieChartProps = {
      type: 'pie',
      ariaLabel: 'Usage',
      data: frames[2].data,
      option: { legend: {} },
      timeline: { currentIndex: 2, frames }
    }
    const view = render(<Chart {...props} />)
    const container = view.container.querySelector<HTMLDivElement>('[data-image-capture-content]')!
    const chart = echarts.getInstanceByDom(container)!
    const currentIndex = () => (chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex

    await act(async () => vi.advanceTimersToNextFrame())
    expect(currentIndex()).toBe(2)

    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 0 }))
    await act(async () => vi.advanceTimersToNextFrame())
    expect(currentIndex()).toBe(0)

    view.rerender(<Chart {...{ ...props }} />)
    await act(async () => vi.advanceTimersToNextFrame())
    expect(currentIndex()).toBe(0)

    view.rerender(<Chart {...props} data={[{ name: 'Model B', value: 40 }]} />)
    await act(async () => vi.advanceTimersToNextFrame())
    expect(currentIndex()).toBe(2)
  })
})

describe('Echarts image capture readiness', () => {
  const initialOption: EChartsCoreOption = {
    animation: false,
    xAxis: { type: 'category', data: ['A'] },
    yAxis: {},
    series: [{ type: 'bar', data: [1] }]
  }
  const props = {
    ariaLabel: 'Usage',
    loading: false,
    loadingColor: '#000',
    loadingLabel: 'Loading',
    loadingTextColor: '#111'
  }
  beforeEach(() => {
    vi.useFakeTimers()
  })

  function mount() {
    const view = render(<Echarts {...props} option={initialOption} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    const capture = () => {
      const event = new ImageCaptureEvent()
      host.dispatchEvent(event)
      expect(event.preparations).toHaveLength(1)
      return event.preparations[0]
    }
    const finish = () => {
      act(() => {
        chart.getZr().animation.update()
        chart.getZr().flush()
      })
    }
    return { ...view, host, chart, capture, finish }
  }

  it('invalidates old readiness on option changes and waits for the real finished event', async () => {
    const view = mount()
    expect(view.host).toHaveAttribute('data-image-capture-content')
    view.finish()
    await expect(view.capture()).resolves.toBeTypeOf('function')
    view.rerender(<Echarts {...props} option={{ ...initialOption, series: [{ type: 'bar', data: [2] }] }} />)
    let ready = false
    const preparation = view.capture().then((restore) => {
      ready = true
      return restore
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    view.finish()
    await expect(preparation).resolves.toBeTypeOf('function')
    expect(view.chart.getOption().series).toEqual([expect.objectContaining({ data: [2] })])
  })

  it('resolves an already finished current version immediately and cleans its listener and timer', async () => {
    const view = mount()
    view.finish()
    const on = vi.spyOn(view.chart, 'on')
    const off = vi.spyOn(view.chart, 'off')
    const timerCount = vi.getTimerCount()
    const restore = await view.capture()
    expect(vi.getTimerCount()).toBe(timerCount)
    expect(off).toHaveBeenCalledWith('finished', on.mock.calls[0][1])
    await restore()
    expect(vi.getTimerCount()).toBe(timerCount)
  })

  it('cleans a waiting preparation after rendering finishes', async () => {
    const view = mount()
    const on = vi.spyOn(view.chart, 'on')
    const off = vi.spyOn(view.chart, 'off')
    const timerCount = vi.getTimerCount()
    const preparation = view.capture()
    expect(vi.getTimerCount()).toBe(timerCount + 1)
    view.finish()
    const restore = await preparation
    expect(off).toHaveBeenCalledWith('finished', on.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(timerCount)
    await restore()
  })

  it.each([false, true])('rejects after 3000ms instead of hanging (loading: %s)', async (loading) => {
    const view = mount()
    if (loading) view.rerender(<Echarts {...props} loading option={initialOption} />)
    // Stop browser frames to reproduce a renderer that never reaches finished.
    view.chart.getZr().animation.stop()
    const off = vi.spyOn(view.chart, 'off')
    const timerCount = vi.getTimerCount()
    const preparation = view.capture()
    const rejection = expect(preparation).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(3000)
    await rejection
    expect(off).toHaveBeenCalledWith('finished', expect.any(Function))
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timerCount)
  })

  it('rejects pending capture on unmount and removes its listener and timer', async () => {
    const view = mount()
    const off = vi.spyOn(view.chart, 'off')
    const preparation = view.capture()
    const rejection = expect(preparation).rejects.toThrow(Error)
    view.unmount()
    await rejection
    expect(view.chart.isDisposed()).toBe(true)
    expect(off).toHaveBeenCalledWith('finished', expect.any(Function))
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    const event = new ImageCaptureEvent()
    view.host.dispatchEvent(event)
    expect(event.preparations).toHaveLength(0)
  })

  it('invalidates readiness on a valid resize and rejects capture if its version changes while waiting', async () => {
    const view = mount()
    view.finish()
    width = 800
    act(() => resize())
    const preparation = view.capture()
    const rejection = expect(preparation).rejects.toThrow('changed')
    view.rerender(<Echarts {...props} option={{ ...initialOption, series: [{ type: 'bar', data: [3] }] }} />)
    await rejection
    view.finish()
    await expect(view.capture()).resolves.toBeTypeOf('function')
  })

  it.each(['loading', 'resize'])('rejects a pending capture when %s invalidates its version', async (change) => {
    const view = mount()
    const preparation = view.capture()
    const rejection = expect(preparation).rejects.toThrow('changed')
    if (change === 'loading') {
      view.rerender(<Echarts {...props} loading option={initialOption} />)
    } else {
      width = 800
      act(() => resize())
    }
    await rejection
  })

  it('rejects a zero-size host even when its previous size finished rendering', async () => {
    const view = mount()
    view.finish()
    width = 0
    act(() => resize())
    const rejection = expect(view.capture()).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(3000)
    await rejection
  })

  it('rejects capture against an externally disposed instance', async () => {
    const view = mount()
    view.chart.dispose()
    await expect(view.capture()).rejects.toThrow('unavailable')
  })
})
