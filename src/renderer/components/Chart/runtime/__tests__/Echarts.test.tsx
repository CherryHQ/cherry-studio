import { render } from '@testing-library/react'
import type { TimelineComponentOption } from 'echarts/components'
import type { EChartsCoreOption } from 'echarts/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Echarts } from '../Echarts'

const instance = vi.hoisted(() => ({
  dispose: vi.fn(),
  hideLoading: vi.fn(),
  resize: vi.fn(),
  showLoading: vi.fn(),
  setOption: vi.fn()
}))

vi.mock('echarts/components', () => ({ AriaComponent: {} }))
vi.mock('echarts/core', () => ({ init: vi.fn(() => instance), use: vi.fn() }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn() }))
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
