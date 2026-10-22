// @vitest-environment jsdom

import type { useVirtualizer as RealUseVirtualizer } from '@tanstack/react-virtual'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render } from '@testing-library/react'
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
    getVirtualItems: () =>
      virtualItems.filter((item) => item.index >= mocks.firstRenderedRow && item.index <= mocks.lastRenderedRow),
    measureElement: vi.fn(),
    measure: mocks.measure,
    resizeItem: mocks.resizeItem
  }
}

const mocks = vi.hoisted(() => ({
  firstRenderedRow: 0,
  lastRenderedRow: Infinity,
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
    mocks.firstRenderedRow = 0
    mocks.lastRenderedRow = Infinity
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.show_line_numbers': false,
      'chat.message.font_size': 14
    })
    mockScrollGeometry({ scrollHeight: 1200, clientHeight: 300 })
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
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

  describe('selection copy', () => {
    const value =
      'const value0 = "abcdefghij"\nconst value1 = "abcdefghij"\nconst value2 = "abcdefghij"\nconst value3 = "abcdefghij"\nconst value4 = "abcdefghij"\nconst value5 = "abcdefghij"'
    const wide = 'nst value1 = "abcdefghij"\nconst value2 = "abcdefghij"\nconst value3 = "abcdefghij"\nco'
    const narrow = 'const value2 = "abcdefghij"\nconst value3 = "abcdefghij"\nco'

    function setup(expanded = false, onRequestExpand?: () => void, code = value) {
      const props = { value: code, onRequestExpand, language: 'typescript', expanded }
      const view = render(<CodeViewer {...props} />)
      const scroller = view.container.querySelector<HTMLElement>('.shiki-scroller')!
      const wrapper = scroller.querySelector<HTMLElement>('.shiki-list > div')!
      const content = (index: number) => scroller.querySelector<HTMLElement>(`[data-index="${index}"] .line-content`)!
      const text = (index: number) => content(index).firstChild!.firstChild!
      const select = (start: Node, startOffset: number, end: Node, endOffset: number) => {
        const range = document.createRange()
        range.setStart(start, startOffset)
        range.setEnd(end, endOffset)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      }
      const pointer = (target: Element | Document, type: string, button = 0, clientX = 10, clientY = 10) => {
        const event = new MouseEvent(type, { bubbles: true, button, clientX, clientY })
        Object.defineProperty(event, 'pointerType', { value: 'mouse' })
        fireEvent(target, event)
      }
      const copy = () => {
        const data = new Map<string, string>()
        const clipboardData = { setData: (type: string, text: string) => data.set(type, text) }
        // jsdom lacks ClipboardEvent; preserve real event cancellation and a controllable clipboard boundary.
        const ClipboardEvent =
          window.ClipboardEvent ??
          class extends Event {
            clipboardData: unknown
            constructor(type: string, init: ClipboardEventInit) {
              super(type, init)
              this.clipboardData = init.clipboardData
            }
          }
        const event = new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboardData as unknown as DataTransfer
        })
        fireEvent(scroller, event)
        return { text: data.get('text/plain'), prevented: event.defaultPrevented }
      }
      return {
        ...view,
        scroller,
        wrapper,
        content,
        text,
        select,
        pointer,
        copy,
        selectWide: () => select(text(1), 2, text(4), 2),
        removeFirstRows: () => {
          mocks.firstRenderedRow = 2
          view.rerender(<CodeViewer {...props} className="after-scroll" />)
        }
      }
    }

    // Before fix: RED — a cold container start cannot resolve.
    it('copies a collapsed selection starting at a container without a cache', () => {
      mocks.firstRenderedRow = 2
      const view = setup()
      view.select(view.wrapper, 0, view.text(4), 2)
      expect(view.copy()).toEqual({ text: narrow, prevented: true })
    })

    // Before fix: GREEN — failed container parsing left the captured wide snapshot intact.
    it('keeps a captured wide selection after rows are removed', () => {
      const view = setup()
      view.selectWide()
      fireEvent.scroll(view.scroller)
      view.removeFirstRows()
      expect(window.getSelection()!.getRangeAt(0).startContainer).toBe(view.wrapper)
      fireEvent.scroll(view.scroller)
      expect(view.copy()).toEqual({ text: wide, prevented: true })
    })

    it('scrolls a captured selection away and back without widening it', () => {
      const lines = Array.from({ length: 60 }, (_, index) => `const value${index} = "abcdefghij"`)
      const code = lines.join('\n')
      mocks.firstRenderedRow = 10
      mocks.lastRenderedRow = 29
      const view = setup(false, undefined, code)
      view.pointer(view.scroller, 'pointerdown')
      view.select(view.text(10), 0, view.text(29), 2)
      view.pointer(document.body, 'pointerup')

      mocks.firstRenderedRow = 20
      mocks.lastRenderedRow = 59
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="scrolled-away" />)
      // Model Chromium relocating the removed row's endpoint to its wrapper.
      view.select(view.wrapper, 0, view.text(29), 2)
      fireEvent.scroll(view.scroller)

      mocks.firstRenderedRow = 0
      mocks.lastRenderedRow = 39
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="scrolled-back" />)
      // Chromium keeps offset zero on scrollback; jsdom adjusts it as rows are inserted.
      view.select(view.wrapper, 0, view.text(29), 2)
      fireEvent.scroll(view.scroller)

      const expected = [...lines.slice(10, 29), 'co'].join('\n')
      expect(expected).toHaveLength(553)
      expect(view.copy()).toEqual({ text: expected, prevented: true })
    })

    it('does not truncate a captured selection when highlighting re-renders the surviving row', () => {
      const code = Array.from({ length: 60 }, (_, index) => `const value${index} = "abcdefghij"`).join('\n')
      mocks.firstRenderedRow = 10
      mocks.lastRenderedRow = 29
      const view = setup(false, undefined, code)
      view.pointer(view.scroller, 'pointerdown')
      view.select(view.text(10), 0, view.text(29), 2)
      view.pointer(document.body, 'pointerup')

      mocks.firstRenderedRow = 20
      mocks.lastRenderedRow = 59
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="scrolled-away" />)
      view.select(view.wrapper, 0, view.content(29), 0)
      fireEvent.scroll(view.scroller)

      expect(view.copy()).toEqual({
        text: 'const value10 = "abcdefghij"\nconst value11 = "abcdefghij"\nconst value12 = "abcdefghij"\nconst value13 = "abcdefghij"\nconst value14 = "abcdefghij"\nconst value15 = "abcdefghij"\nconst value16 = "abcdefghij"\nconst value17 = "abcdefghij"\nconst value18 = "abcdefghij"\nconst value19 = "abcdefghij"\nconst value20 = "abcdefghij"\nconst value21 = "abcdefghij"\nconst value22 = "abcdefghij"\nconst value23 = "abcdefghij"\nconst value24 = "abcdefghij"\nconst value25 = "abcdefghij"\nconst value26 = "abcdefghij"\nconst value27 = "abcdefghij"\nconst value28 = "abcdefghij"\nco',
        prevented: true
      })
    })

    it('keeps a captured selection when the context menu opens', () => {
      const lines = Array.from({ length: 60 }, (_, index) => `const value${index} = "abcdefghij"`)
      const code = lines.join('\n')
      mocks.firstRenderedRow = 10
      mocks.lastRenderedRow = 29
      const view = setup(false, undefined, code)
      view.pointer(view.scroller, 'pointerdown')
      view.select(view.text(10), 0, view.text(29), 2)
      view.pointer(document.body, 'pointerup')

      mocks.firstRenderedRow = 20
      mocks.lastRenderedRow = 59
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="scrolled-away" />)
      view.select(view.wrapper, 0, view.text(29), 2)
      view.pointer(view.scroller, 'pointerdown', 2)
      view.pointer(document.body, 'pointerup', 2)
      fireEvent.contextMenu(view.scroller)

      const expected = [...lines.slice(10, 29), 'co'].join('\n')
      expect(expected).toHaveLength(553)
      expect(view.copy()).toEqual({ text: expected, prevented: true })
    })

    it('keeps a captured selection after a keyboard edit followed by a highlight re-render', () => {
      const lines = Array.from({ length: 60 }, (_, index) => `const value${index} = "abcdefghij"`)
      const code = lines.join('\n')
      mocks.firstRenderedRow = 10
      mocks.lastRenderedRow = 29
      const view = setup(false, undefined, code)
      view.pointer(view.scroller, 'pointerdown')
      view.select(view.text(10), 0, view.text(29), 2)
      view.pointer(document.body, 'pointerup')

      mocks.firstRenderedRow = 20
      mocks.lastRenderedRow = 59
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="scrolled-away" />)
      view.select(view.wrapper, 0, view.text(29), 2)
      fireEvent.keyDown(view.scroller, { key: 'ArrowLeft', shiftKey: true })
      fireEvent.scroll(view.scroller)
      // Model highlighting relocating the surviving endpoint after the keyboard edit was committed.
      view.select(view.wrapper, 0, view.content(29), 0)

      const expected = [...lines.slice(10, 29), 'co'].join('\n')
      expect(expected).toHaveLength(553)
      expect(view.copy()).toEqual({ text: expected, prevented: true })
    })

    it('keeps the snapshot when a touch pan starts and cancels', () => {
      const code = Array.from({ length: 60 }, (_, index) => `const value${index} = "abcdefghij"`).join('\n')
      mocks.firstRenderedRow = 10
      mocks.lastRenderedRow = 29
      const view = setup(false, undefined, code)
      view.pointer(view.scroller, 'pointerdown')
      view.select(view.text(10), 0, view.text(29), 2)
      view.pointer(document.body, 'pointerup')

      for (const type of ['pointerdown', 'pointercancel']) {
        // jsdom lacks PointerEvent; add pointerType to a real MouseEvent.
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 })
        Object.defineProperty(event, 'pointerType', { value: 'touch' })
        fireEvent(view.scroller, event)
      }
      mocks.firstRenderedRow = 20
      mocks.lastRenderedRow = 59
      view.rerender(<CodeViewer value={code} language="typescript" expanded={false} className="after-touch-pan" />)
      view.select(view.wrapper, 0, view.text(29), 2)
      fireEvent.scroll(view.scroller)

      expect(view.copy()).toEqual({
        text: 'const value10 = "abcdefghij"\nconst value11 = "abcdefghij"\nconst value12 = "abcdefghij"\nconst value13 = "abcdefghij"\nconst value14 = "abcdefghij"\nconst value15 = "abcdefghij"\nconst value16 = "abcdefghij"\nconst value17 = "abcdefghij"\nconst value18 = "abcdefghij"\nconst value19 = "abcdefghij"\nconst value20 = "abcdefghij"\nconst value21 = "abcdefghij"\nconst value22 = "abcdefghij"\nconst value23 = "abcdefghij"\nconst value24 = "abcdefghij"\nconst value25 = "abcdefghij"\nconst value26 = "abcdefghij"\nconst value27 = "abcdefghij"\nconst value28 = "abcdefghij"\nco',
        prevented: true
      })
    })

    // Before fix: RED — completion outside the viewer never captured the logical range.
    it('captures the completed selection on pointerup', () => {
      const view = setup()
      view.pointer(view.scroller, 'pointerdown')
      view.selectWide()
      view.pointer(document.body, 'pointerup')
      view.removeFirstRows()
      fireEvent.scroll(view.scroller)
      expect(view.copy()).toEqual({ text: wide, prevented: true })
    })

    // Before fix: RED — copy unconditionally preferred the old wide cache.
    it.each([true, false])(
      'replaces a cached wide selection with a smaller real-line selection (pointerup=%s)',
      (pointerup) => {
        const view = setup()
        view.selectWide()
        fireEvent.scroll(view.scroller)
        view.select(view.text(3), 6, view.text(3), 12)
        if (pointerup) {
          view.pointer(view.scroller, 'pointerdown')
          view.select(view.text(3), 6, view.text(3), 12)
          view.pointer(document.body, 'pointerup')
        } else {
          fireEvent.keyDown(view.scroller, { key: 'ArrowLeft', shiftKey: true })
        }
        expect(view.copy()).toEqual({ text: 'value3', prevented: true })
      }
    )

    // Before fix: RED — a new gesture left the preceding selection's snapshot alive.
    it('does not merge a new container selection with the previous gesture', () => {
      const view = setup()
      view.selectWide()
      fireEvent.scroll(view.scroller)
      view.pointer(view.scroller, 'pointerdown')
      mocks.lastRenderedRow = 3
      view.rerender(<CodeViewer value={value} language="typescript" expanded={false} className="last-row-three" />)
      view.select(view.text(3), 6, view.wrapper, view.wrapper.childNodes.length)
      view.pointer(document.body, 'pointerup')
      expect(view.copy()).toEqual({ text: 'value3 = "abcdefghij"', prevented: true })
    })

    it.each([
      ['right button', 2, 10, 10],
      ['middle button', 1, 10, 10],
      ['vertical scrollbar', 0, 640, 10],
      ['horizontal scrollbar', 0, 10, 300]
    ] as const)('preserves a captured selection during %s gestures', (_name, button, clientX, clientY) => {
      const view = setup()
      view.selectWide()
      fireEvent.scroll(view.scroller)
      view.pointer(view.scroller, 'pointerdown', button, clientX, clientY)
      view.removeFirstRows()
      view.pointer(document.body, 'pointerup')
      expect(view.copy()).toEqual({ text: wide, prevented: true })
    })

    it('commits on pointercancel and removes the completion listener', () => {
      const view = setup()
      view.pointer(view.scroller, 'pointerdown')
      view.selectWide()
      view.pointer(document.body, 'pointercancel')
      view.select(view.text(3), 6, view.text(3), 12)
      view.pointer(document.body, 'pointerup')
      view.removeFirstRows()
      fireEvent.scroll(view.scroller)
      expect(view.copy()).toEqual({ text: wide, prevented: true })
    })

    it('uses the current DOM selection rather than the snapshot to request expansion', () => {
      vi.useFakeTimers()
      let expanded = false
      try {
        const view = setup(false, () => {
          expanded = true
        })
        view.selectWide()
        fireEvent.scroll(view.scroller)
        view.select(view.text(3), 6, view.text(3), 12)
        fireEvent(document, new Event('selectionchange'))
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(expanded).toBe(false)
        view.select(view.text(2), 0, view.text(3), 0)
        fireEvent(document, new Event('selectionchange'))
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(expanded).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    // Before fix: GREEN — text offsets and next-line content offset zero keep their source text.
    it.each([
      ['single line', 1, 1, 1, 7, 'onst v', false],
      ['multiple lines', 1, 0, 3, 6, 'const value1 = "abcdefghij"\nconst value2 = "abcdefghij"\nconst ', false],
      ['triple click', 2, 0, 3, 0, 'const value2 = "abcdefghij"\n', true]
    ] as const)(
      'keeps ordinary copy text unchanged (%s)',
      (_name, startLine, startOffset, endLine, endOffset, expected, elementEnd) => {
        const view = setup()
        view.select(
          view.text(startLine),
          startOffset,
          elementEnd ? view.content(endLine) : view.text(endLine),
          endOffset
        )
        expect(view.copy()).toEqual({ text: expected, prevented: true })
      }
    )

    // Before fix: GREEN — expanded and foreign selections belong to native copy.
    it('leaves expanded and outside selections to native copy', () => {
      const expanded = setup(true)
      expanded.selectWide()
      expect(expanded.copy()).toEqual({ text: undefined, prevented: false })
      expanded.unmount()
      const view = setup()
      view.selectWide()
      fireEvent.scroll(view.scroller)
      const outside = document.createTextNode('outside')
      document.body.append(outside)
      try {
        view.select(outside, 0, outside, 3)
        expect(view.copy()).toEqual({ text: undefined, prevented: false })
        view.select(view.text(3), 0, outside, 3)
        expect(view.copy()).toEqual({ text: undefined, prevented: false })
        const other = setup()
        other.selectWide()
        expect(view.copy()).toEqual({ text: undefined, prevented: false })
      } finally {
        outside.remove()
      }
    })
  })
})
