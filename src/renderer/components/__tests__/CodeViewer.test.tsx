// @vitest-environment jsdom
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, waitFor } from '@testing-library/react'
import * as htmlToImage from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureScrollableAsBlob, captureScrollableAsDataUrl } from '../../utils/image'
import CodeViewer from '../CodeViewer'

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }))

const getCodePreProperties = async () => ({ class: 'shiki' })
const captureHighlight = vi.hoisted(() => ({ read: vi.fn(), cleanup: vi.fn() }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    getCodePreProperties,
    isCodeThemeDark: false,
    highlightRange: captureHighlight.read,
    cleanupTokenizers: captureHighlight.cleanup
  })
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
  captureHighlight.read.mockReset()
  captureHighlight.cleanup.mockReset()
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
  it.each(['data-url', 'blob', 'failure', 'offscreen-highlighted'] as const)(
    'captures every source line and restores virtualization after %s',
    async (mode) => {
      const lines = [...Array.from({ length: 120 }, (_, index) => `line ${index}  `), '']
      lines[119] = 'final line 🍒  '
      const highlighted = mode === 'offscreen-highlighted'
      if (highlighted) prefixHeight = 5000
      captureHighlight.read.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { start: 0, lines: lines.map((content) => [{ content, offset: 0, color: '#ff0000' }]) }
      })
      const { container } = render(
        <CodeViewer value={lines.join('\n')} language="text" expanded options={{ highlight: highlighted }} />
      )
      expect(container.querySelectorAll('.line-content').length).toBeLessThan(lines.length)
      vi.mocked(htmlToImage.toCanvas).mockImplementation(async (root) => {
        expect([...root.querySelectorAll('.line-content')].map((line) => line.textContent)).toEqual(lines)
        if (highlighted)
          expect(root.querySelector('[data-index="119"] .line-content span')).toHaveStyle({ color: '#ff0000' })
        if (mode === 'failure') throw new Error('rasterization failed')
        return Object.assign(document.createElement('canvas'), { toDataURL: () => 'data:image/png;base64,dGVzdA==' })
      })
      const result =
        mode === 'blob'
          ? captureScrollableAsBlob({ current: container }, (blob) => {
              expect(blob?.type).toBe('image/png')
              expect(blob?.size).toBe(4)
            })
          : captureScrollableAsDataUrl({ current: container })
      if (mode === 'failure') {
        await waitFor(() => expect(result).rejects.toThrow('rasterization failed'))
      } else {
        await waitFor(() =>
          expect(result).resolves.toBe(mode === 'blob' ? undefined : 'data:image/png;base64,dGVzdA==')
        )
      }
      expect(container.querySelectorAll('.line-content').length).toBeLessThan(lines.length)
    }
  )

  it('restores prepared viewers when another viewer cannot prepare its capture', async () => {
    const value = Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n')
    captureHighlight.read.mockRejectedValueOnce(new Error('preparation failed'))
    const { container } = render(
      <>
        <CodeViewer value={value} language="text" expanded options={{ highlight: false }} />
        <CodeViewer value={value} language="text" expanded />
      </>
    )
    const result = captureScrollableAsDataUrl({ current: container })
    await waitFor(() => expect(result).rejects.toThrow('preparation failed'))
    for (const viewer of container.querySelectorAll('.code-viewer')) {
      expect(viewer.querySelectorAll('.line-content').length).toBeLessThan(120)
      expect(viewer.querySelector('[data-index="119"]')).toBeNull()
    }
  })

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

  it('copies a new selection immediately after saving a different range on scroll', () => {
    const { container, getByText } = render(
      <div style={{ overflowY: 'auto', height: 300 }}>
        <CodeViewer value={'line 1\nline 2\nline 3'} language="text" expanded />
      </div>
    )
    const selection = window.getSelection()!
    const select = (text: string) => {
      const range = document.createRange()
      range.selectNodeContents(getByText(text))
      selection.removeAllRanges()
      selection.addRange(range)
    }
    select('line 3')
    fireEvent.scroll(container.querySelector('.shiki-scroller')!)
    select('line 2')
    let copied = ''
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (_type: string, value: string) => {
          copied = value
        }
      }
    })
    getByText('line 2').dispatchEvent(event)
    selection.removeAllRanges()
    expect(copied).toBe('line 2')
  })

  it('retains the source range when virtualization removes a selection endpoint', async () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`)
    const { container, getByText, queryByText } = render(
      <CodeViewer value={lines.join('\n')} language="text" expanded={false} wrapped={false} height={300} />
    )
    const range = document.createRange()
    range.setStart(getByText('line 2').firstChild!, 0)
    range.setEnd(getByText('line 30').firstChild!, 7)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const scroller = container.querySelector<HTMLElement>('.shiki-scroller')!
    scroller.scrollTop = 900
    fireEvent.scroll(scroller)
    await waitFor(() => expect(queryByText('line 2')).toBeNull())
    let copied = ''
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (_type: string, value: string) => {
          copied = value
        }
      }
    })
    scroller.dispatchEvent(event)
    selection.removeAllRanges()
    expect(copied).toBe(lines.slice(2, 31).join('\n'))
  })

  it('copies the logical range after both endpoints unmount, until the user starts another selection', async () => {
    const lines = Array.from({ length: 10_000 }, (_, index) => `line ${index}`)
    const { getByText, queryByText, getByTestId } = render(
      <div data-testid="outer" style={{ overflowY: 'auto', height: 300 }}>
        <CodeViewer value={lines.join('\n')} language="text" expanded wrapped={false} />
      </div>
    )
    const range = document.createRange()
    range.setStart(getByText('line 2').firstChild!, 0)
    range.setEnd(getByText('line 10').firstChild!, 7)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const outer = getByTestId('outer')
    outer.scrollTop = 3000
    fireEvent.scroll(outer)
    await waitFor(() => expect(queryByText('line 10')).toBeNull())
    expect(queryByText('line 2')).toBeNull()
    expect(selection.isCollapsed).toBe(true)
    fireEvent(document, new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 120))
    const copy = () => {
      let copied = ''
      const event = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData: (_type: string, value: string) => {
            copied = value
          }
        }
      })
      document.body.dispatchEvent(event)
      return { copied, prevented: event.defaultPrevented }
    }
    expect(copy()).toEqual({ copied: lines.slice(2, 11).join('\n'), prevented: true })
    fireEvent.pointerDown(outer)
    expect(copy()).toEqual({ copied: '', prevented: false })
    selection.removeAllRanges()
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
