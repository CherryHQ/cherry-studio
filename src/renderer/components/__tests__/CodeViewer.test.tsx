// @vitest-environment jsdom

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render } from '@testing-library/react'
import stringWidth from 'string-width'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

const mocks = vi.hoisted(() => {
  // The real useVirtualizer returns one stable instance per component across
  // renders and keeps state per instance; the mock keys that state off the
  // stable per-instance getItemKey so sibling viewers never share measurements.
  interface VirtualizerState {
    count: number
    instance: Record<string, unknown>
  }
  const instances = new WeakMap<object, VirtualizerState>()
  const measure = vi.fn()
  const resizeItem = vi.fn()
  const stateFor = (key: object): VirtualizerState => {
    let state = instances.get(key)
    if (!state) {
      const measuredSizes = new Map<number, number>()
      const sizeOf = (index: number) => measuredSizes.get(index) ?? 20
      state = {
        count: 0,
        instance: {
          getTotalSize: () => {
            let total = 0
            for (let i = 0; i < state!.count; i++) total += sizeOf(i)
            return total
          },
          getVirtualItems: () =>
            Array.from({ length: state!.count }, (_, index) => {
              let start = 0
              for (let i = 0; i < index; i++) start += sizeOf(i)
              return { index, key: `row-${index}`, start }
            }),
          measureElement: (element: HTMLElement | null) => {
            if (!element) return
            const rawIndex = element.getAttribute('data-index')
            if (rawIndex === null) return
            const size = element.clientHeight
            if (size > 0) measuredSizes.set(Number(rawIndex), size)
          },
          resizeItem: (index: number, size: number) => {
            resizeItem(index, size)
            measuredSizes.set(index, size)
          },
          measure
        }
      }
      instances.set(key, state)
    }
    return state
  }
  const createVirtualizer = (options: { count: number; getItemKey: (index: number) => string }) => {
    const state = stateFor(options.getItemKey)
    state.count = options.count
    return state.instance
  }
  return {
    highlightLines: vi.fn(),
    resetHighlight: vi.fn(),
    measure,
    resizeItem,
    stateFor,
    createVirtualizer,
    useVirtualizer: vi.fn(createVirtualizer)
  }
})

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
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollHeight')

function mockScrollGeometry(geometry: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperties(window.HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight }
  })
}

function restoreDescriptor(key: 'clientHeight' | 'scrollHeight', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(window.HTMLElement.prototype, key, descriptor)
    return
  }
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>)[key]
}

function mockRowHeights(measuredHeights: Map<number, number>) {
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const index = this.getAttribute('data-index')
      return index === null ? 300 : (measuredHeights.get(Number(index)) ?? 20)
    }
  })
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

  it('positions each virtual row with its own translateY offset', () => {
    const { container } = render(
      <CodeViewer value={'line 1\nline 2\nline 3'} language="typescript" maxHeight="350px" />
    )

    const rows = Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.style.transform)).toEqual(['translateY(0px)', 'translateY(20px)', 'translateY(40px)'])
  })

  it('repositions later rows when a measured row height exceeds its estimate', () => {
    // Row 0 measures 55px tall (e.g. a wrapped line); rows report geometry via
    // the measureElement ref, so placement after the measurement must follow it.
    mockRowHeights(new Map([[0, 55]]))

    const { container, rerender } = render(
      <CodeViewer value={'line 1\nline 2\nline 3'} language="typescript" maxHeight="350px" />
    )
    const transforms = () =>
      (Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)

    expect(transforms()).toEqual(['translateY(0px)', 'translateY(20px)', 'translateY(40px)'])

    // The real virtualizer re-renders when a measurement lands; simulate that
    // with a layout-neutral prop change since the mock has no subscription.
    rerender(
      <CodeViewer className="remeasure" value={'line 1\nline 2\nline 3'} language="typescript" maxHeight="350px" />
    )

    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)', 'translateY(75px)'])
  })

  it('keeps measured row heights and placement while content streams in', () => {
    // Row 0 measures 55px; a stream update adds row 1, whose placement must
    // follow the measured height instead of falling back to the 20px estimate
    // (which would overlap row 0).
    mockRowHeights(new Map([[0, 55]]))

    const { container, rerender } = render(<CodeViewer value={'line 1'} language="typescript" maxHeight="350px" />)
    const transforms = () =>
      (Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)

    mocks.measure.mockClear()
    mocks.resizeItem.mockClear()
    rerender(<CodeViewer value={'line 1\nline 2'} language="typescript" maxHeight="350px" />)

    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])
    expect(mocks.measure).not.toHaveBeenCalled()
    expect(mocks.resizeItem).not.toHaveBeenCalled()
  })

  it('keeps row counts and measurements independent across sibling viewers', () => {
    // Sibling code blocks each get their own virtualizer state: the first
    // viewer's measured rows and 3-line count must not leak into the second.
    const firstHeights = new Map([[0, 55]])
    const secondHeights = new Map([[0, 30]])
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        const index = this.getAttribute('data-index')
        if (index === null) return 300
        const heights =
          this.closest('[data-row-heights]')?.getAttribute('data-row-heights') === 'second'
            ? secondHeights
            : firstHeights
        return heights.get(Number(index)) ?? 20
      }
    })

    const first = (className?: string) => (
      <div data-row-heights="first">
        <CodeViewer value={'line 1\nline 2\nline 3'} language="typescript" className={className} maxHeight="350px" />
      </div>
    )
    const second = (className?: string) => (
      <div data-row-heights="second">
        <CodeViewer value={'line 1\nline 2'} language="typescript" className={className} maxHeight="350px" />
      </div>
    )

    const { container, rerender } = render(
      <>
        {first()}
        {second('sibling')}
      </>
    )

    rerender(
      <>
        {first('remeasure')}
        {second('sibling remeasure')}
      </>
    )

    const transformsOf = (scroller: Element) =>
      (Array.from(scroller.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)
    const scrollers = container.querySelectorAll('.shiki-scroller')

    expect(transformsOf(scrollers[0])).toEqual(['translateY(0px)', 'translateY(55px)', 'translateY(75px)'])
    expect(transformsOf(scrollers[1])).toEqual(['translateY(0px)', 'translateY(30px)'])
  })

  it('remasures virtual rows and resets scroll position when expanding a collapsed code block', () => {
    mockRowHeights(new Map([[0, 55]]))

    const { container, rerender } = render(
      <CodeViewer value={'line 1\nline 2'} language="typescript" expanded={false} maxHeight="350px" />
    )
    const scroller = container.querySelector('.shiki-scroller') as HTMLElement
    const transforms = () =>
      (Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)

    scroller.scrollTop = 80
    rerender(
      <CodeViewer
        className="remeasure"
        value={'line 1\nline 2'}
        language="typescript"
        expanded={false}
        maxHeight="350px"
      />
    )
    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])

    rerender(<CodeViewer value={'line 1\nline 2'} language="typescript" expanded maxHeight="350px" />)
    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])
    expect(scroller.scrollTop).toBe(0)
    expect(mocks.measure).not.toHaveBeenCalled()
  })

  it('remasures virtual rows when line numbers are toggled', () => {
    mockRowHeights(new Map([[0, 55]]))

    const { container, rerender } = render(
      <CodeViewer
        value={'line 1\nline 2'}
        language="typescript"
        wrapped
        options={{ lineNumbers: false }}
        maxHeight="350px"
      />
    )
    const transforms = () =>
      (Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)

    rerender(
      <CodeViewer
        className="remeasure"
        value={'line 1\nline 2'}
        language="typescript"
        wrapped
        options={{ lineNumbers: false }}
        maxHeight="350px"
      />
    )
    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])

    rerender(
      <CodeViewer
        value={'line 1\nline 2'}
        language="typescript"
        wrapped
        options={{ lineNumbers: true }}
        maxHeight="350px"
      />
    )
    expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])
    expect(mocks.measure).not.toHaveBeenCalled()
  })

  it('positions a later row using offscreen wrapped row estimates in the virtualizer', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const longLine = 'x'.repeat(100)
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${longLine}\nline 3`} language="text" wrapped maxHeight="350px" />)

      const row1Resize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(row1Resize).toBeDefined()
      const middleRowHeight = row1Resize![1] as number
      expect(middleRowHeight).toBeGreaterThan(lineHeight)

      const options = mocks.useVirtualizer.mock.calls.at(-1)![0] as {
        getItemKey: (index: number) => string
      }
      const getVirtualItems = mocks.stateFor(options.getItemKey).instance.getVirtualItems as () => Array<{
        index: number
        start: number
      }>
      const virtualItems = getVirtualItems()
      expect(virtualItems[2]?.start).toBe(21 + middleRowHeight)
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('applies tab-size on the scroller so tab width matches wrapped row estimates', () => {
    const { container } = render(<CodeViewer value="line 1" language="text" wrapped />)
    const scroller = container.querySelector('.shiki-scroller') as HTMLElement
    expect(scroller.style.tabSize).toBe('2')
  })

  it('estimates enough height for offscreen wrapped rows with tab-expanded width', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const tabLine = '\t'.repeat(10) + 'x'.repeat(90)
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${tabLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      const narrowCharsPerRow = 4
      const visualColumns = 20 + 90
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(visualColumns / narrowCharsPerRow))
      expect(estimatedHeight).toBeGreaterThan(lineHeight * Math.ceil(tabLine.length / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('estimates enough height for offscreen wrapped rows with emoji', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const emojiLine = '🎉'.repeat(40)
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${emojiLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      const narrowCharsPerRow = 4
      const visualColumns = stringWidth(emojiLine)
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(visualColumns / narrowCharsPerRow))
      expect(estimatedHeight).toBeGreaterThan(lineHeight * Math.ceil(emojiLine.length / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('estimates enough height for offscreen wrapped rows with ANSI color sequences', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const esc = '\u001b'
    const ansiLine = `${esc}[31m${'x'.repeat(40)}${esc}[0m`
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${ansiLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      const narrowCharsPerRow = 4
      const visualColumns = stringWidth(ansiLine.replaceAll('\u001b', '').replaceAll('\u009b', ''))
      expect(visualColumns).toBeGreaterThan(stringWidth(ansiLine))
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(visualColumns / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('estimates enough height for offscreen wrapped rows with C1 CSI ANSI sequences', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const csi = '\u009b'
    const ansiLine = `${csi}[31m${'x'.repeat(40)}${csi}[0m`
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${ansiLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      const narrowCharsPerRow = 4
      const visualColumns = stringWidth(ansiLine.replaceAll('\u001b', '').replaceAll('\u009b', ''))
      expect(visualColumns).toBeGreaterThan(stringWidth(ansiLine))
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(visualColumns / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('estimates enough height for offscreen wrapped rows with wide glyphs', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const wideLine = '你'.repeat(50)
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${wideLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      const narrowCharsPerRow = 4
      const visualColumns = wideLine.length * 2
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(visualColumns / narrowCharsPerRow))
      expect(estimatedHeight).toBeGreaterThan(lineHeight * Math.ceil(wideLine.length / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('estimates enough height for offscreen wrapped rows in narrow scrollers', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const longLine = 'x'.repeat(100)
    mockRowHeights(new Map([[0, 21]]))
    const lineHeight = 21
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      render(<CodeViewer value={`line 1\n${longLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const estimatedHeight = offscreenResize![1] as number
      // Narrow scroller (~4 chars/row at fontSize 13) needs far more than the old 8-char floor.
      const narrowCharsPerRow = 4
      expect(estimatedHeight).toBeGreaterThanOrEqual(lineHeight * Math.ceil(longLine.length / narrowCharsPerRow))
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('does not shrink offscreen wrapped rows below their cached height when remeasuring', () => {
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const longSecondLine = 'x'.repeat(200)
    mockRowHeights(new Map([[0, 55]]))

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 800
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 55
        }
      })

      const { rerender } = render(
        <CodeViewer value={`line 1\n${longSecondLine}`} language="text" wrapped maxHeight="350px" />
      )

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      const cachedOffscreenSize = offscreenResize![1] as number

      mocks.resizeItem.mockClear()

      rerender(
        <CodeViewer
          className="remeasure"
          value={`line 1\n${longSecondLine}`}
          language="text"
          wrapped
          maxHeight="350px"
        />
      )

      const remeasureOffscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(remeasureOffscreenResize?.[1]).toBeGreaterThanOrEqual(cachedOffscreenSize)
      expect(cachedOffscreenSize).toBeGreaterThan(20)
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('keeps measured row placement when the scroller is resized in wrapped mode', () => {
    const resizeCallbacks: Array<() => void> = []
    class MockResizeObserver {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    try {
      mockRowHeights(new Map([[0, 55]]))

      const { container, rerender } = render(
        <CodeViewer value={'line 1\nline 2'} language="typescript" wrapped maxHeight="350px" />
      )
      const transforms = () =>
        (Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[]).map((row) => row.style.transform)

      rerender(
        <CodeViewer className="remeasure" value={'line 1\nline 2'} language="typescript" wrapped maxHeight="350px" />
      )
      expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])

      mocks.measure.mockClear()
      resizeCallbacks.at(-1)?.()
      rerender(
        <CodeViewer
          className="remeasure resize"
          value={'line 1\nline 2'}
          language="typescript"
          wrapped
          maxHeight="350px"
        />
      )

      expect(transforms()).toEqual(['translateY(0px)', 'translateY(55px)'])
      expect(mocks.measure).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('updates offscreen row height when an existing line grows without a layout change', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const shortLine = 'x'.repeat(20)
    const longLine = 'x'.repeat(120)
    mockRowHeights(new Map([[0, 21]]))
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      const { rerender } = render(
        <CodeViewer value={`line 1\n${shortLine}`} language="text" wrapped maxHeight="350px" />
      )

      mocks.resizeItem.mockClear()

      rerender(<CodeViewer value={`line 1\n${longLine}`} language="text" wrapped maxHeight="350px" />)

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      expect(offscreenResize![1] as number).toBeGreaterThan(21)
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('remeasures an earlier changed line when a new line is appended', () => {
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const shortLine = 'x'.repeat(20)
    const longLine = 'x'.repeat(120)
    mockRowHeights(new Map([[0, 21]]))
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains('shiki-scroller')) return 72
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 21
        }
      })

      const { rerender } = render(
        <CodeViewer value={`line 1\n${shortLine}\ntail`} language="text" wrapped maxHeight="350px" />
      )

      mocks.resizeItem.mockClear()

      rerender(
        <CodeViewer value={`line 1\n${longLine}\ntail\nnew line`} language="text" wrapped maxHeight="350px" />
      )

      const offscreenResize = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenResize).toBeDefined()
      expect(offscreenResize![1] as number).toBeGreaterThan(21)
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
    }
  })

  it('clears offscreen wrapped row cache when line-number gutter digit width changes', () => {
    const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')
    mocks.useVirtualizer.mockImplementation((options: { count: number; getItemKey: (index: number) => string }) => {
      const state = mocks.stateFor(options.getItemKey)
      state.count = options.count
      return {
        ...state.instance,
        getVirtualItems: () => [{ index: 0, key: 'row-0', start: 0 }]
      }
    })

    const longSecondLine = 'x'.repeat(200)
    const value100 = Array.from({ length: 100 }, (_, index) => (index === 1 ? longSecondLine : `line ${index}`)).join(
      '\n'
    )
    const value99 = Array.from({ length: 99 }, (_, index) => (index === 1 ? longSecondLine : `line ${index}`)).join(
      '\n'
    )
    mockRowHeights(new Map([[0, 55]]))

    try {
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          // Narrow enough that 3-digit vs 2-digit gutter changes chars-per-row.
          if (this.classList?.contains('shiki-scroller')) return 300
          const index = this.getAttribute('data-index')
          return index === null ? 300 : 55
        }
      })

      const { rerender } = render(
        <CodeViewer value={value100} language="text" wrapped maxHeight="350px" options={{ lineNumbers: true }} />
      )

      const offscreenAt100 = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenAt100).toBeDefined()
      const cachedAtThreeDigitGutter = offscreenAt100![1] as number

      mocks.resizeItem.mockClear()

      rerender(
        <CodeViewer
          className="remeasure"
          value={value99}
          language="text"
          wrapped
          maxHeight="350px"
          options={{ lineNumbers: true }}
        />
      )

      const offscreenAt99 = mocks.resizeItem.mock.calls.find(([index]) => index === 1)
      expect(offscreenAt99).toBeDefined()
      expect(offscreenAt99![1] as number).toBeLessThan(cachedAtThreeDigitGutter)
    } finally {
      mocks.useVirtualizer.mockImplementation(mocks.createVirtualizer)
      if (originalClientWidthDescriptor) {
        Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
      }
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
