// @vitest-environment jsdom

import type { useVirtualizer as RealUseVirtualizer } from '@tanstack/react-virtual'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

type VirtualizerOptions = { count: number; estimateSize?: (index: number) => number }

function createVirtualizerMock(options: VirtualizerOptions) {
  const sizes = Array.from({ length: options.count }, (_, index) => options.estimateSize?.(index) ?? 20)
  let totalSize = 0
  const virtualItems = sizes.map((size, index) => {
    const start = totalSize
    totalSize += size
    return { index, key: `row-${index}`, start, size }
  })

  return {
    getTotalSize: () => totalSize,
    getVirtualItems: () => virtualItems,
    measureElement: vi.fn(),
    measure: mocks.measure,
    resizeItem: mocks.resizeItem
  }
}

const mocks = vi.hoisted(() => ({
  highlightLines: vi.fn(),
  resetHighlight: vi.fn(),
  measureElement: vi.fn(),
  measure: vi.fn(),
  resizeItem: vi.fn(),
  useVirtualizer: vi.fn((options: VirtualizerOptions) => createVirtualizerMock(options))
}))

vi.mock('@renderer/hooks/useCodeHighlight', () => ({
  useCodeHighlight: ({ rawLines }: { rawLines: string[] }) => ({
    tokenLines: rawLines.map((line) => [
      {
        content: line,
        offset: 0,
        color: 'inherit',
        bgColor: 'inherit',
        htmlStyle: {}
      }
    ]),
    highlightLines: mocks.highlightLines,
    resetHighlight: mocks.resetHighlight
  })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    getShikiPreProperties: vi.fn(async () => ({ class: 'shiki' })),
    isShikiThemeDark: false
  })
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: mocks.useVirtualizer
}))

const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientHeight')
const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollHeight')

function mockScrollGeometry(geometry: { scrollHeight: number; clientHeight: number; clientWidth?: number }) {
  Object.defineProperties(window.HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
    clientWidth: { configurable: true, get: () => geometry.clientWidth ?? 640 },
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight }
  })
}

function restoreDescriptor(
  key: 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'offsetHeight' | 'offsetWidth' | 'scrollTo',
  descriptor?: PropertyDescriptor
) {
  if (descriptor) {
    Object.defineProperty(window.HTMLElement.prototype, key, descriptor)
    return
  }
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>)[key]
}

describe('CodeViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.show_line_numbers': false,
      'chat.message.font_size': 14
    })
    mockScrollGeometry({ scrollHeight: 1200, clientHeight: 300 })
  })

  afterEach(() => {
    restoreDescriptor('clientHeight', originalClientHeightDescriptor)
    restoreDescriptor('clientWidth', originalClientWidthDescriptor)
    restoreDescriptor('scrollHeight', originalScrollHeightDescriptor)
  })

  it('keeps the collapsed internal scroller pinned to bottom while content grows', () => {
    const { container, rerender } = render(
      <CodeViewer value="line 1" language="typescript" expanded={false} maxHeight="350px" autoScrollToBottom />
    )
    const scroller = container.querySelector('.shiki-scroller') as HTMLElement

    rerender(
      <CodeViewer value="line 1\nline 2" language="typescript" expanded={false} maxHeight="350px" autoScrollToBottom />
    )

    expect(scroller.scrollTop).toBe(1200)
  })

  it('does not force the collapsed internal scroller back to bottom after the user scrolls away', () => {
    const { container, rerender } = render(
      <CodeViewer value="line 1" language="typescript" expanded={false} maxHeight="350px" autoScrollToBottom />
    )
    const scroller = container.querySelector('.shiki-scroller') as HTMLElement
    scroller.scrollTop = 100
    fireEvent.scroll(scroller)

    rerender(
      <CodeViewer value="line 1\nline 2" language="typescript" expanded={false} maxHeight="350px" autoScrollToBottom />
    )

    expect(scroller.scrollTop).toBe(100)
  })

  it('highlights only viewport-visible viewers immediately when many code blocks mount together', async () => {
    vi.useFakeTimers()
    const rectSpy = vi
      .spyOn(window.HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const viewportState = this.closest('[data-viewport-state]')?.getAttribute('data-viewport-state')
        return viewportState === 'visible' ? new DOMRect(10, 10, 320, 80) : new DOMRect(10, 10_000, 320, 80)
      })
    const lineCounts = Array.from({ length: 12 }, (_, index) => index + 1)
    const requestedCounts = () => mocks.highlightLines.mock.calls.map(([count]) => count).sort((a, b) => a - b)

    try {
      render(
        <>
          {lineCounts.map((lineCount) => (
            <div key={lineCount} data-viewport-state={lineCount <= 2 ? 'visible' : 'offscreen'}>
              <CodeViewer
                value={Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n')}
                language="typescript"
              />
            </div>
          ))}
        </>
      )

      expect(requestedCounts()).toEqual([1, 2])

      await vi.runAllTimersAsync()
      expect(requestedCounts()).toEqual(lineCounts)
    } finally {
      rectSpy.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('debounces every highlight request after the first one', async () => {
    vi.useFakeTimers()
    const rectSpy = vi
      .spyOn(window.HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 10, 320, 80))
    try {
      const { rerender } = render(<CodeViewer value={'line 1'} language="typescript" />)
      mocks.highlightLines.mockClear()

      rerender(<CodeViewer value={'line 1\nline 2'} language="typescript" />)
      expect(mocks.highlightLines).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(300)
      expect(mocks.highlightLines).toHaveBeenCalledWith(2)
    } finally {
      rectSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not request syntax highlighting when highlighting is disabled', () => {
    render(<CodeViewer value="line 1\nline 2" language="typescript" options={{ highlight: false }} />)

    expect(mocks.highlightLines).not.toHaveBeenCalled()
    expect(mocks.resetHighlight).not.toHaveBeenCalled()
  })

  it('clears highlighting resources when highlighting is disabled after being enabled', () => {
    const { rerender } = render(<CodeViewer value="line 1" language="typescript" options={{ highlight: true }} />)

    rerender(<CodeViewer value="line 1\nline 2" language="typescript" options={{ highlight: false }} />)

    expect(mocks.resetHighlight).toHaveBeenCalled()
  })

  it('renders code at full opacity while highlighting is disabled, not dimmed', () => {
    const { container } = render(
      <CodeViewer value="const a = 1" language="typescript" options={{ highlight: false }} />
    )

    const tokenSpans = container.querySelectorAll('.line-content > span')
    expect(tokenSpans.length).toBeGreaterThan(0)
    tokenSpans.forEach((span) => {
      expect((span as HTMLElement).style.opacity).not.toBe('0.35')
    })
    // The un-highlighted fallback renders the raw text at full opacity
    expect(Array.from(tokenSpans).some((span) => (span as HTMLElement).style.opacity === '1')).toBe(true)
  })

  it('estimates taller virtual rows for wrapped long lines than short lines', () => {
    const longLine = 'x'.repeat(500)
    const props = {
      value: `${longLine}\nshort`,
      language: 'python',
      wrapped: true,
      expanded: false,
      maxHeight: '350px'
    } as const
    const { rerender } = render(<CodeViewer {...props} />)

    // Re-render once so estimateSize sees the mounted scroller width.
    rerender(<CodeViewer {...props} />)

    const virtualizerOptions = mocks.useVirtualizer.mock.calls.at(-1)?.[0] as VirtualizerOptions
    expect(virtualizerOptions.estimateSize?.(0)).toBeGreaterThan(virtualizerOptions.estimateSize?.(1) ?? 0)

    const virtualItems = createVirtualizerMock(virtualizerOptions).getVirtualItems()
    expect(virtualItems[0]?.size).toBeGreaterThan(virtualItems[1]?.size ?? 0)
    expect(virtualItems[1]?.start).toBe(virtualItems[0]?.size)

    mocks.resizeItem.mockClear()
    mocks.measure.mockClear()
    rerender(<CodeViewer {...props} value={`${longLine}more\nshort`} />)

    // A streamed value update resizes only the changed rows; it must never run a
    // full remeasure, which would discard every row's DOM measurement.
    expect(mocks.measure).not.toHaveBeenCalled()
    expect(mocks.resizeItem).toHaveBeenCalledTimes(1)
  })

  it('remeasures wrapped rows when the gutter layout changes', () => {
    const props = {
      value: 'line 1\nline 2',
      language: 'python',
      wrapped: true,
      expanded: false,
      maxHeight: '350px'
    } as const
    const { rerender } = render(<CodeViewer {...props} />)
    mocks.measure.mockClear()

    rerender(<CodeViewer {...props} options={{ lineNumbers: true }} />)
    expect(mocks.measure).toHaveBeenCalledTimes(1)

    // Re-rendering with the same layout signature must not remeasure again.
    rerender(<CodeViewer {...props} options={{ lineNumbers: true }} />)
    expect(mocks.measure).toHaveBeenCalledTimes(1)
  })

  it('renders streamed wrapped rows at their measured virtual offsets', async () => {
    const { useVirtualizer: realUseVirtualizer } = await vi.importActual<{ useVirtualizer: typeof RealUseVirtualizer }>(
      '@tanstack/react-virtual'
    )
    const defaultUseVirtualizerImpl = mocks.useVirtualizer.getMockImplementation()

    // Simulated layout: every row is line-height tall per visual row and wraps at
    // the same width the estimator assumes, so DOM sizes match estimates — except
    // the streamed line, which wraps to more visual rows than the char-count
    // estimate predicts (the real-world variable-width-glyph case the offset math
    // must survive).
    const fontSize = 13
    const lineHeightPx = Math.round(fontSize * 1.6)
    const scrollerClientWidth = 640
    const scrollerViewportHeight = 300
    const estimateCharsPerRow = Math.floor((scrollerClientWidth - fontSize * 2) / (fontSize * 0.6))
    const estimateVisualRows = (line: string) => Math.max(1, Math.ceil(line.length / estimateCharsPerRow))
    const streamedLine = 'y'.repeat(200)
    const streamedLineVisualRows = 5
    const rowHeight = (line: string) =>
      lineHeightPx * (line === streamedLine ? streamedLineVisualRows : estimateVisualRows(line))
    const rowOffsetHeight = (element: HTMLElement) => {
      if (element.hasAttribute('data-index')) return rowHeight(element.textContent ?? '')
      if (element.classList.contains('shiki-scroller')) return scrollerViewportHeight
      return 0
    }

    const originalOffsetHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetHeight')
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetWidth')
    const originalScrollTo = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollTo')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: function (this: HTMLElement) {
          return rowOffsetHeight(this)
        }
      })
      Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get: function (this: HTMLElement) {
          return this.hasAttribute('data-index') || this.classList.contains('shiki-scroller') ? scrollerClientWidth : 0
        }
      })
      // jsdom does not implement Element.scrollTo; the real virtualizer calls it.
      Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: () => {},
        writable: true
      })

      // Run the real @tanstack/react-virtual against the simulated geometry; the
      // module-level mock must be restored so later tests keep their virtualizer stub.
      mocks.useVirtualizer.mockImplementation(
        realUseVirtualizer as unknown as NonNullable<typeof defaultUseVirtualizerImpl>
      )

      const longLine = 'x'.repeat(100)
      const lines = Array.from({ length: 40 }, () => longLine)
      const estimateRowPx = lineHeightPx * estimateVisualRows(longLine)
      const props = { language: 'python', wrapped: true, expanded: false, maxHeight: '350px' } as const

      const { container, rerender } = render(<CodeViewer {...props} value={lines.join('\n')} />)

      const list = container.querySelector('.shiki-list') as HTMLElement
      const offsetContainer = list.firstElementChild as HTMLElement

      // All rows measure to the same simulated wrapped height, so total size and the
      // first row's offset come from DOM measurements, not single-line guesses.
      expect(list.style.height).toBe(`${lines.length * estimateRowPx}px`)
      expect(offsetContainer.style.transform).toBe('translateY(0px)')

      // Stream a longer first line whose true wrapped height exceeds its estimate:
      // the virtualizer must receive the DOM height, not the estimate.
      const streamedLines = [streamedLine, ...lines.slice(1)]
      rerender(<CodeViewer {...props} value={streamedLines.join('\n')} />)

      const streamedRowPx = lineHeightPx * streamedLineVisualRows
      expect(list.style.height).toBe(`${streamedRowPx + (lines.length - 1) * estimateRowPx}px`)
      expect(offsetContainer.style.transform).toBe('translateY(0px)')

      // Scrolling into the estimated region: the first rendered row must sit at the
      // cumulative true height of every row before it — the overlap regression
      // behind issue #21151.
      const scroller = container.querySelector('.shiki-scroller') as HTMLElement
      scroller.scrollTop = 1500
      fireEvent.scroll(scroller)

      const renderedRows = Array.from(container.querySelectorAll('[data-index]'))
      expect(renderedRows.length).toBeGreaterThan(0)
      const firstRenderedIndex = parseInt(renderedRows[0].getAttribute('data-index') ?? '0', 10)
      expect(firstRenderedIndex).toBeGreaterThan(0)
      const expectedOffset = streamedLines.slice(0, firstRenderedIndex).reduce((acc, line) => acc + rowHeight(line), 0)
      expect(offsetContainer.style.transform).toBe(`translateY(${expectedOffset}px)`)
    } finally {
      if (defaultUseVirtualizerImpl) {
        mocks.useVirtualizer.mockImplementation(defaultUseVirtualizerImpl)
      }
      restoreDescriptor('offsetHeight', originalOffsetHeight)
      restoreDescriptor('offsetWidth', originalOffsetWidth)
      restoreDescriptor('scrollTo', originalScrollTo)
    }
  })

  it('lets the line-content flex item shrink so long unbreakable lines wrap instead of overflowing', () => {
    // The wrapped line-content must be able to shrink below its min-content width
    // (base64, URLs, minified JSON), otherwise long lines overflow the container
    // and get clipped by the line's paint containment with no way to scroll to them.
    const { container } = render(
      <CodeViewer
        value="long=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        language="text"
        wrapped
      />
    )

    const lineContent = container.querySelector('.line-content')
    expect(lineContent).toHaveClass('min-w-0')
    // The descendants-facing wrap classes must carry `!important` so they win
    // over `.markdown pre span { white-space: pre }` inside chat code blocks.
    expect(lineContent).toHaveClass('[&_*]:whitespace-pre-wrap!')
    expect(lineContent).toHaveClass('[&_*]:break-words!')
  })
})
