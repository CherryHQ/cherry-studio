// @vitest-environment jsdom

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

const mocks = vi.hoisted(() => ({
  highlightLines: vi.fn(),
  resetHighlight: vi.fn(),
  measureElement: vi.fn(),
  useVirtualizer: vi.fn((options: { count: number }) => ({
    getTotalSize: () => options.count * 20,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 20
      })),
    measureElement: vi.fn()
  }))
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
    const rectSpy = vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
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
