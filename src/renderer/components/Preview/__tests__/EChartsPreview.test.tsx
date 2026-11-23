import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EChartsPreview from '../EChartsPreview'

const mocks = vi.hoisted(() => ({
  chart: {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn()
  },
  init: vi.fn(),
  theme: { theme: 'light' },
  imageActions: {
    pan: vi.fn(),
    zoom: vi.fn(),
    copy: vi.fn(),
    download: vi.fn(),
    dialog: vi.fn()
  },
  resizeObserver: {
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn()
  }
}))

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

vi.mock('echarts', () => ({
  __esModule: true,
  init: mocks.init,
  default: { init: mocks.init }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'code_block.preview.invalid_json' ? 'Invalid JSON configuration' : key)
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => mocks.theme
}))

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: vi.fn(() => mocks.imageActions)
}))

vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <div data-testid="loading-indicator" />
}))

describe('EChartsPreview', () => {
  const validOption = JSON.stringify({
    xAxis: { type: 'category', data: ['A', 'B'] },
    yAxis: { type: 'value' },
    series: [{ data: [1, 2], type: 'bar' }]
  })
  let resizeCallback: ResizeObserverCallback | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.chart.setOption.mockReset()
    mocks.chart.resize.mockReset()
    mocks.chart.dispose.mockReset()
    mocks.init.mockReset()
    mocks.init.mockImplementation((container: HTMLElement) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      container.appendChild(svg)
      return mocks.chart
    })
    mocks.theme.theme = 'light'
    resizeCallback = undefined
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 256 } as DOMRect)
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation(function ResizeObserverMock(callback: ResizeObserverCallback) {
        resizeCallback = callback
        return mocks.resizeObserver
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const advanceDebounce = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
  }

  const getChartContainer = () => document.querySelector('.echarts') as HTMLElement

  const stubContainerSize = (width: number, height: number) => {
    const container = getChartContainer()
    if (container) {
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width, height } as DOMRect)
    }
  }

  const fireResize = (width: number, height: number) => {
    act(() => {
      resizeCallback?.([{ contentRect: { width, height } } as unknown as ResizeObserverEntry], mocks.resizeObserver)
    })
  }

  it('shows a loading indicator while the chart is debounced', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
  })

  it('parses and renders a valid JSON option into an svg container', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    const container = mocks.init.mock.calls[0][0] as HTMLElement

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLElement), undefined, { renderer: 'svg' })
    expect(mocks.chart.setOption).toHaveBeenCalledWith(
      { backgroundColor: 'transparent', ...JSON.parse(validOption) },
      true
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('uses dark theme when the app theme is dark', async () => {
    mocks.theme.theme = 'dark'
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLElement), 'dark', { renderer: 'svg' })
  })

  it('reports a JSON parse error as a render failure without drawing a chart', async () => {
    render(<EChartsPreview>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    expect(screen.getByText('preview.render.failed')).toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  // Catches Details receiving only the translated summary instead of the parser's reason and location.
  it('keeps the JSON parser reason and location in the payload Details opens', async () => {
    render(<EChartsPreview>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    fireEvent.click(screen.getByRole('button', { name: 'common.detail' }))
    await vi.waitFor(() => expect(detailMocks.open).toHaveBeenCalled())

    const request = detailMocks.open.mock.calls[0][0]
    expect(request.localizedErrorMessage).toBe('preview.render.failed')
    expect(request.error.name).toBe('SyntaxError')
    expect(request.error.message).toContain('line 1 column 2')
    expect(request.error.message).not.toBe('Invalid JSON configuration')
  })

  it('reports an ECharts setOption error as a render failure without the library text', async () => {
    mocks.chart.setOption.mockImplementation(() => {
      throw new Error('Invalid option')
    })
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    expect(screen.getByText('preview.render.failed')).toBeInTheDocument()
    expect(screen.queryByText('Invalid option')).not.toBeInTheDocument()
  })

  it('reuses the existing instance when children changes', async () => {
    const { rerender } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()
    expect(mocks.init).toHaveBeenCalledTimes(1)

    const updatedOption = JSON.stringify({ series: [{ data: [3, 4], type: 'line' }] })
    rerender(<EChartsPreview>{updatedOption}</EChartsPreview>)
    await advanceDebounce()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.chart.setOption).toHaveBeenCalledTimes(2)
    expect(mocks.chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining(JSON.parse(updatedOption)), true)
  })

  it('re-initializes the chart when the theme changes', async () => {
    const { rerender } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()
    expect(mocks.init).toHaveBeenCalledTimes(1)

    mocks.theme.theme = 'dark'
    rerender(<EChartsPreview enableToolbar>{validOption}</EChartsPreview>)
    await advanceDebounce()

    expect(mocks.chart.dispose).toHaveBeenCalledTimes(1)
    expect(mocks.init).toHaveBeenCalledTimes(2)
    expect(mocks.init).toHaveBeenLastCalledWith(expect.any(HTMLElement), 'dark', { renderer: 'svg' })
  })

  it('disposes the chart when the component unmounts', async () => {
    const { unmount } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    unmount()
    expect(mocks.chart.dispose).toHaveBeenCalledTimes(1)
  })

  it('calls chart.resize when ResizeObserver reports positive dimensions', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    fireResize(640, 256)

    expect(mocks.chart.resize).toHaveBeenCalledTimes(1)
  })

  it('does not initialize the chart in a zero-sized container', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    stubContainerSize(0, 0)
    await advanceDebounce()

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.chart.setOption).not.toHaveBeenCalled()
  })

  it('initializes the chart with the latest ready option when the container transitions from zero to positive size', async () => {
    const { rerender } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    stubContainerSize(0, 0)
    await advanceDebounce()

    expect(mocks.init).not.toHaveBeenCalled()

    const updatedOption = JSON.stringify({ series: [{ data: [5, 6], type: 'line' }] })
    rerender(<EChartsPreview>{updatedOption}</EChartsPreview>)
    await advanceDebounce()

    expect(mocks.init).not.toHaveBeenCalled()

    fireResize(640, 256)

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.chart.setOption).toHaveBeenCalledWith(expect.objectContaining(JSON.parse(updatedOption)), true)
  })

  it('calls resize on subsequent positive-size ResizeObserver notifications without re-initializing', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    fireResize(640, 256)
    fireResize(800, 400)

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.chart.resize).toHaveBeenCalledTimes(2)
  })

  it('does not initialize the chart when ResizeObserver reports zero dimensions', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    stubContainerSize(0, 0)
    await advanceDebounce()

    fireResize(0, 0)

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.chart.resize).not.toHaveBeenCalled()
  })

  it('does not re-initialize with a stale option after invalid JSON follows a valid render', async () => {
    const { rerender } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()
    expect(mocks.init).toHaveBeenCalledTimes(1)

    // Simulate the container becoming hidden and dispose the instance via a theme change.
    stubContainerSize(0, 0)
    mocks.theme.theme = 'dark'
    rerender(<EChartsPreview enableToolbar>{validOption}</EChartsPreview>)
    await advanceDebounce()

    // The disposed chart should not be re-initialized while the container has no size.
    expect(mocks.init).toHaveBeenCalledTimes(1)

    // Now replace the valid option with invalid JSON while still hidden.
    rerender(<EChartsPreview enableToolbar>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    expect(screen.getByText('preview.render.failed')).toBeInTheDocument()

    // Becoming visible again must not resurrect the previous valid option.
    fireResize(640, 256)

    expect(mocks.init).toHaveBeenCalledTimes(1)
  })

  it('does not surface JSON parse errors while streaming', async () => {
    render(<EChartsPreview isStreaming>{'{invalid'}</EChartsPreview>)

    await advanceDebounce()

    expect(screen.queryByText('preview.render.failed')).not.toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it('does not commit a partial option even if it parses as valid JSON while streaming', async () => {
    const partial = JSON.stringify({ xAxis: { type: 'category' } })
    render(<EChartsPreview isStreaming>{partial}</EChartsPreview>)

    await advanceDebounce()

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.chart.setOption).not.toHaveBeenCalled()
  })

  it('keeps suppressing errors and partial renders through a streaming pause longer than the debounce delay', async () => {
    const { rerender } = render(<EChartsPreview isStreaming>{'{invalid'}</EChartsPreview>)

    // Pause longer than the 300 ms debounce while still streaming.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(screen.queryByText('preview.render.failed')).not.toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()

    rerender(<EChartsPreview>{validOption}</EChartsPreview>)

    // Should render immediately without waiting for the debounce interval.
    await act(async () => {})

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.chart.setOption).toHaveBeenCalledWith(expect.objectContaining(JSON.parse(validOption)), true)
  })

  it('renders the final option immediately when streaming completes', async () => {
    const { rerender } = render(<EChartsPreview isStreaming>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    rerender(<EChartsPreview>{validOption}</EChartsPreview>)

    // Should render immediately without waiting for the debounce interval.
    await act(async () => {})

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.chart.setOption).toHaveBeenCalledWith(expect.objectContaining(JSON.parse(validOption)), true)
  })

  it('reports invalid JSON as a render failure after streaming completes', async () => {
    const { rerender } = render(<EChartsPreview isStreaming>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    rerender(<EChartsPreview>{'{invalid'}</EChartsPreview>)

    await act(async () => {})

    expect(screen.getByText('preview.render.failed')).toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it('debounces updates after streaming completes', async () => {
    const { rerender } = render(<EChartsPreview isStreaming>{validOption}</EChartsPreview>)
    await advanceDebounce()

    rerender(<EChartsPreview>{validOption}</EChartsPreview>)
    await act(async () => {})
    expect(mocks.chart.setOption).toHaveBeenCalledTimes(1)

    const updatedOption = JSON.stringify({ series: [{ data: [3, 4], type: 'line' }] })
    rerender(<EChartsPreview>{updatedOption}</EChartsPreview>)

    expect(mocks.chart.setOption).toHaveBeenCalledTimes(1)

    await advanceDebounce()

    expect(mocks.chart.setOption).toHaveBeenCalledTimes(2)
    expect(mocks.chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining(JSON.parse(updatedOption)), true)
  })
})
