// @vitest-environment jsdom

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

const mocks = vi.hoisted(() => ({
  highlightLines: vi.fn(),
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
    highlightLines: mocks.highlightLines
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
})
