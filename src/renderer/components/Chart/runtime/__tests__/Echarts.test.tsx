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

echarts.use([BarChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TimelineComponent])
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
  it('keeps the current option while loading and applies the next option when loading finishes', () => {
    const initialOption = { xAxis: { type: 'category' }, yAxis: {}, series: [{ type: 'bar', data: [1] }] }
    const nextOption = { ...initialOption, series: [{ type: 'bar', data: [2] }] }
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

    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    expect(chart.getOption().series).toEqual([expect.objectContaining({ data: [1] })])

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

    expect(host).toHaveAttribute('aria-busy', 'true')
    expect(chart.getOption().series).toEqual([expect.objectContaining({ data: [1] })])

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

    expect(host).toHaveAttribute('aria-busy', 'false')
    expect(chart.getOption().series).toEqual([expect.objectContaining({ data: [2] })])
  })

  it('keeps base components when applying a timeline frame', () => {
    const timeline: TimelineComponentOption = { data: ['Jul 27', 'Jul 28'] }
    const option: EChartsCoreOption = {
      baseOption: {
        legend: {},
        timeline,
        series: [{ type: 'pie', data: [{ name: 'Model A', value: 10 }] }]
      },
      options: [
        { series: [{ type: 'pie', data: [{ name: 'Model A', value: 10 }] }] },
        { series: [{ type: 'pie', data: [{ name: 'Model A', value: 20 }] }] }
      ]
    }

    const view = render(
      <Echarts
        ariaLabel="Usage"
        loading={false}
        loadingColor="#000"
        loadingLabel="Loading"
        loadingTextColor="#111"
        option={option}
      />
    )

    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 1 }))
    expect(chart.getOption().legend).toHaveLength(1)
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(1)
    expect(chart.getOption().series).toEqual([expect.objectContaining({ data: [{ name: 'Model A', value: 20 }] })])
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

    view.rerender(
      <Chart
        {...props}
        timeline={{
          currentIndex: 2,
          frames: [{ ...frames[0], data: [{ name: 'Model B', value: 40 }] }, ...frames.slice(1)]
        }}
      />
    )
    await act(async () => vi.advanceTimersToNextFrame())
    expect(currentIndex()).toBe(0)
    expect(chart.getOption().series).toEqual([expect.objectContaining({ data: [{ name: 'Model B', value: 40 }] })])
  })
})

describe('Echarts timeline replay', () => {
  const props = {
    ariaLabel: 'Usage',
    loading: false,
    loadingColor: '#000',
    loadingLabel: 'Loading',
    loadingTextColor: '#111'
  }
  function createOption(frameCount = 4) {
    const timeline: TimelineComponentOption = {
      axisType: 'category',
      autoPlay: false,
      loop: false,
      currentIndex: frameCount - 1,
      data: Array.from({ length: frameCount }, (_, index) => `Day ${index + 1}`)
    }
    return {
      baseOption: {
        animation: true,
        timeline,
        series: [{ type: 'pie', animationDuration: 150, animationDurationUpdate: 150 }]
      },
      options: Array.from({ length: frameCount }, (_, index) => ({
        series: [
          {
            type: 'pie',
            data: [
              { name: 'Model A', value: (index + 1) * 10 },
              { name: 'Model B', value: 50 - index * 10 }
            ]
          }
        ]
      }))
    }
  }

  it('preserves the user-selected frame when an equivalent new option is replayed', async () => {
    vi.useFakeTimers()
    const view = render(<Echarts {...props} option={createOption()} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    await act(async () => vi.advanceTimersToNextFrame())
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(3)

    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 1 }))
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(1)

    const replay = createOption()
    view.rerender(<Echarts {...props} option={replay} />)
    await act(async () => vi.advanceTimersToNextFrame())
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(1)
    expect(replay.baseOption.timeline.currentIndex).toBe(3)
  })

  it('preserves the selected frame only when timeline labels remain the same', async () => {
    vi.useFakeTimers()
    const view = render(<Echarts {...props} option={createOption()} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    await act(async () => vi.advanceTimersToNextFrame())
    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 1 }))

    view.rerender(<Echarts {...props} option={createOption()} />)
    await act(async () => vi.advanceTimersToNextFrame())
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(1)

    const nextOption = createOption()
    nextOption.baseOption.timeline.data = ['Day 5', 'Day 6', 'Day 7', 'Day 8']
    nextOption.baseOption.timeline.currentIndex = 2
    view.rerender(<Echarts {...props} option={nextOption} />)
    await act(async () => vi.advanceTimersToNextFrame())
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(2)
  })

  it('waits for the new finished event before capture during a timeline animation', async () => {
    vi.useFakeTimers()
    const view = render(<Echarts {...props} option={createOption()} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    const waitForFinished = () =>
      new Promise<void>((resolve) => {
        const onFinished = () => {
          chart.off('finished', onFinished)
          resolve()
        }
        chart.on('finished', onFinished)
      })
    const flush = () => {
      act(() => {
        chart.getZr().animation.update()
        chart.getZr().flush()
      })
    }
    const initialFinished = waitForFinished()
    flush()
    flush()
    await act(async () => vi.advanceTimersByTimeAsync(1500))
    flush()
    expect(chart.getZr().animation.isFinished()).toBe(true)
    await initialFinished

    const finished = waitForFinished()
    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 0 }))
    expect((chart.getOption().timeline as TimelineComponentOption[])[0].currentIndex).toBe(0)
    expect(chart.getZr().animation.isFinished()).toBe(false)
    const event = new ImageCaptureEvent()
    host.dispatchEvent(event)
    expect(event.preparations).toHaveLength(1)
    const preparation = event.preparations[0]
    const readiness = Promise.race([
      preparation.then(() => 'ready'),
      new Promise<string>((resolve) => setTimeout(() => resolve('animating'), 30))
    ])
    flush()
    await act(async () => vi.advanceTimersByTimeAsync(30))
    expect(await readiness).toBe('animating')
    expect(chart.getZr().animation.isFinished()).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(1500))
    flush()
    await finished
    await expect(preparation).resolves.toBeTypeOf('function')
  })

  it.each([0, 2, 3, 6])('uses the option default index when the frame count changes to %i', async (frameCount) => {
    vi.useFakeTimers()
    const view = render(<Echarts {...props} option={createOption()} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    await act(async () => vi.advanceTimersToNextFrame())
    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 3 }))

    const nextOption = createOption(frameCount)
    nextOption.baseOption.timeline.currentIndex = 0
    view.rerender(<Echarts {...props} option={nextOption} />)
    await act(async () => vi.advanceTimersToNextFrame())
    const timeline = (chart.getOption().timeline as TimelineComponentOption[])[0]
    expect(timeline.data).toHaveLength(frameCount)
    expect(timeline.currentIndex).toBe(0)
    expect(nextOption.baseOption.timeline.currentIndex).toBe(0)
  })

  it('rejects a pending capture when another timeline change starts', async () => {
    const view = render(<Echarts {...props} option={createOption()} />)
    const host = view.getByRole('img', { name: 'Usage' }) as HTMLDivElement
    const chart = echarts.getInstanceByDom(host)!
    const event = new ImageCaptureEvent()
    host.dispatchEvent(event)
    expect(event.preparations).toHaveLength(1)
    const rejection = expect(event.preparations[0]).rejects.toThrow('Chart changed during image capture')
    act(() => chart.dispatchAction({ type: 'timelineChange', currentIndex: 1 }))
    await rejection
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

  function mount(option = initialOption) {
    const view = render(<Echarts {...props} option={option} />)
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

  it('invalidates readiness and rejects a waiting capture on datazoom', async () => {
    const view = mount({ ...initialOption, dataZoom: { type: 'inside', start: 0, end: 100 } })
    view.finish()
    await expect(view.capture()).resolves.toBeTypeOf('function')

    act(() => view.chart.dispatchAction({ type: 'dataZoom', start: 0, end: 50 }))
    expect(view.chart.getOption().dataZoom).toEqual([expect.objectContaining({ end: 50 })])
    let ready = false
    const preparation = view.capture().then((restore) => {
      ready = true
      return restore
    })
    const rejection = expect(preparation).rejects.toThrow('Chart changed during image capture')
    await Promise.resolve()
    expect(ready).toBe(false)
    act(() => view.chart.dispatchAction({ type: 'dataZoom', start: 0, end: 75 }))
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
