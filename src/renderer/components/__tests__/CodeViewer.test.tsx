// @vitest-environment jsdom
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CodeViewer from '../CodeViewer'

const getCodePreProperties = async () => ({ class: 'shiki' })
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ getCodePreProperties, isCodeThemeDark: false })
}))
vi.mock('@renderer/hooks/useCodeHighlight', () => ({
  useCodeHighlight: () => ({ tokens: null, highlightLines, resetHighlight })
}))
const highlightLines = async () => {}
const resetHighlight = () => {}
const originalDescriptors = Object.getOwnPropertyDescriptors(HTMLElement.prototype)
let prefixHeight = 0
let scrollHeight = 1200
let measuredRowHeight: (element: HTMLElement) => number = () => 21

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.show_line_numbers': false,
    'chat.message.font_size': 14
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  prefixHeight = 0
  scrollHeight = 1200
  measuredRowHeight = () => 21
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 640 },
    clientHeight: { configurable: true, get: () => 300 },
    offsetWidth: { configurable: true, get: () => 640 },
    offsetHeight: {
      configurable: true,
      get() {
        return this.hasAttribute('data-index') ? measuredRowHeight(this) : 300
      }
    },
    scrollHeight: { configurable: true, get: () => scrollHeight },
    scrollTo: {
      configurable: true,
      value({ top }: { top: number }) {
        this.scrollTop = top
      }
    }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const parent = this.closest<HTMLElement>('[data-testid="outer"]')
    const top = this.classList.contains('shiki-list') ? prefixHeight - (parent?.scrollTop ?? 0) : 0
    return { top, bottom: top + 300, left: 0, right: 640, width: 640, height: 300, x: 0, y: top, toJSON() {} }
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const key of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight', 'scrollHeight', 'scrollTo']) {
    const descriptor = originalDescriptors[key]
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})

describe('CodeViewer', () => {
  it('keeps expanded documents virtualized and scrolls using the outer viewport and list offset', async () => {
    prefixHeight = 600
    const lines = Array.from({ length: 10000 }, (_, index) => `line ${index}`)
    const { container, getByTestId } = render(
      <div data-testid="outer" style={{ overflowY: 'auto', height: 300 }}>
        <div style={{ height: prefixHeight }} />
        <CodeViewer value={lines.join('\n')} language="text" expanded wrapped={false} />
      </div>
    )
    const outer = getByTestId('outer')
    expect(container.querySelectorAll('[data-index]')).toHaveLength(0)
    outer.scrollTop = prefixHeight
    fireEvent.scroll(outer)
    await waitFor(() => expect(container.querySelector('.line-content')?.textContent).toBe('line 0'))
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(80)
    outer.scrollTop = prefixHeight + 10000 * 21 - 300
    fireEvent.scroll(outer)
    await waitFor(() => expect(container.querySelector('[data-index="9999"]')?.textContent).toBe('line 9999'))
    expect(container.querySelectorAll('[data-index]').length).toBeLessThan(80)
    const first = container.querySelector<HTMLElement>('[data-index]')!
    expect(first.parentElement?.style.transform).toBe(`translateY(${Number(first.dataset.index) * 21}px)`)
  })

  it('preserves trailing whitespace and blank lines with highlighting disabled', () => {
    const { container } = render(
      <CodeViewer
        value={'hello  \n\t🍒\n'}
        language="text"
        expanded={false}
        height={300}
        options={{ highlight: false }}
      />
    )
    const lines = [...container.querySelectorAll('.line-content')]
    expect(lines).toHaveLength(3)
    expect(lines[0].textContent).toBe('hello  ')
    expect(lines[1].textContent).toBe('\t🍒')
    expect(lines[0].querySelector('span')?.style.opacity).toBe('1')
  })

  it('copies complete line contents when selection endpoints are elements', () => {
    const { container } = render(
      <CodeViewer value={'const first = "🍒"\nconst last = 42'} language="text" expanded={false} height={300} />
    )
    const lines = container.querySelectorAll('.line-content')
    const range = document.createRange()
    range.setStart(lines[0], 0)
    range.setEnd(lines[1], lines[1].childNodes.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    let copied = ''
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData(type: string, value: string) {
          if (type === 'text/plain') copied = value
        }
      }
    })
    lines[0].dispatchEvent(event)
    selection.removeAllRanges()
    expect(copied).toBe('const first = "🍒"\nconst last = 42')
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps a growing collapsed viewer pinned until the user scrolls away', () => {
    const props = { language: 'text', expanded: false, height: 300, autoScrollToBottom: true } as const
    const { container, rerender } = render(<CodeViewer {...props} value="first" />)
    const scroller = container.querySelector<HTMLElement>('.shiki-scroller')!
    expect(scroller.scrollTop).toBe(1200)
    scrollHeight = 1400
    rerender(<CodeViewer {...props} value={'first\nsecond'} />)
    expect(scroller.scrollTop).toBe(1400)
    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    scrollHeight = 1600
    rerender(<CodeViewer {...props} value={'first\nsecond\nthird'} />)
    expect(scroller.scrollTop).toBe(100)
  })

  it('uses measured wrapped heights after streaming changes a row', () => {
    const streamedLine = 'y'.repeat(200)
    measuredRowHeight = (element) => (element.textContent === streamedLine ? 105 : 42)
    const lines = Array.from({ length: 100 }, () => 'x'.repeat(100))
    const props = { language: 'text', expanded: false, height: 300, wrapped: true } as const
    const { container, rerender } = render(<CodeViewer {...props} value={lines.join('\n')} />)
    const list = container.querySelector<HTMLElement>('.shiki-list')!
    expect(list.style.height).toBe('4200px')
    rerender(<CodeViewer {...props} value={[streamedLine, ...lines.slice(1)].join('\n')} />)
    expect(list.style.height).toBe('4263px')
    const scroller = container.querySelector<HTMLElement>('.shiki-scroller')!
    scroller.scrollTop = 2000
    fireEvent.scroll(scroller)
    const first = container.querySelector<HTMLElement>('[data-index]')!
    const index = Number(first.dataset.index)
    expect(index).toBeGreaterThan(0)
    expect(first.parentElement?.style.transform).toBe(`translateY(${105 + (index - 1) * 42}px)`)
  })
})
