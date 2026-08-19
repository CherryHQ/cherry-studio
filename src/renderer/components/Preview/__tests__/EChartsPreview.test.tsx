import { act, render, screen } from '@testing-library/react'
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
  useImageTools: () => mocks.imageActions
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
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
        resizeCallback = callback
        return mocks.resizeObserver
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const advanceDebounce = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
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
    expect(mocks.chart.setOption).toHaveBeenCalledWith(JSON.parse(validOption), true)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('uses dark theme when the app theme is dark', async () => {
    mocks.theme.theme = 'dark'
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLElement), 'dark', { renderer: 'svg' })
  })

  it('surfaces JSON parse errors in PreviewError', async () => {
    render(<EChartsPreview>{'{invalid'}</EChartsPreview>)
    await advanceDebounce()

    expect(screen.getByText('Invalid JSON configuration')).toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it('surfaces ECharts setOption errors', async () => {
    mocks.chart.setOption.mockImplementation(() => {
      throw new Error('Invalid option')
    })
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    expect(screen.getByText('Invalid option')).toBeInTheDocument()
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
    expect(mocks.chart.setOption).toHaveBeenLastCalledWith(JSON.parse(updatedOption), true)
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

  it('calls chart.resize when ResizeObserver fires', async () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    await advanceDebounce()

    act(() => {
      resizeCallback?.([], mocks.resizeObserver as unknown as ResizeObserver)
    })

    expect(mocks.chart.resize).toHaveBeenCalledTimes(1)
  })
})
