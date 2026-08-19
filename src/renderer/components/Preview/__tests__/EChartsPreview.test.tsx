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
  init: mocks.init
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
    vi.unstubAllGlobals()
  })

  it('parses and renders a valid JSON option into an svg container', () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    const container = mocks.init.mock.calls[0][0] as HTMLElement

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLElement), undefined, { renderer: 'svg' })
    expect(mocks.chart.setOption).toHaveBeenCalledWith(JSON.parse(validOption))
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('uses dark theme when the app theme is dark', () => {
    mocks.theme.theme = 'dark'
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    expect(mocks.init).toHaveBeenCalledWith(expect.any(HTMLElement), 'dark', { renderer: 'svg' })
  })

  it('surfaces JSON parse errors in PreviewError', () => {
    render(<EChartsPreview>{'{invalid'}</EChartsPreview>)
    expect(screen.getByText('配置 JSON 格式错误')).toBeInTheDocument()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it('surfaces ECharts setOption errors', () => {
    mocks.chart.setOption.mockImplementation(() => {
      throw new Error('Invalid option')
    })
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    expect(screen.getByText('Invalid option')).toBeInTheDocument()
  })

  it('disposes the previous instance when children changes', () => {
    const { rerender } = render(<EChartsPreview>{validOption}</EChartsPreview>)
    expect(mocks.chart.dispose).not.toHaveBeenCalled()

    rerender(<EChartsPreview>{JSON.stringify({ series: [] })}</EChartsPreview>)
    expect(mocks.chart.dispose).toHaveBeenCalledTimes(1)
  })

  it('calls chart.resize when ResizeObserver fires', () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    act(() => {
      resizeCallback?.([], mocks.resizeObserver as unknown as ResizeObserver)
    })
    expect(mocks.chart.resize).toHaveBeenCalledTimes(1)
  })

  it('calls chart.resize on window resize', () => {
    render(<EChartsPreview>{validOption}</EChartsPreview>)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(mocks.chart.resize).toHaveBeenCalledTimes(1)
  })
})
