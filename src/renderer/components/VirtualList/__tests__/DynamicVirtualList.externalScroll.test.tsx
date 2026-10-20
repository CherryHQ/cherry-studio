import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DynamicVirtualList, type DynamicVirtualListRef } from '..'

const items = Array.from({ length: 100 }, (_, index) => `Model ${index}`)
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
let headerHeight = 120
const resizeCallbacks = new Map<Element, Set<() => void>>()

function Page() {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  return (
    <div ref={setViewport} role="region" aria-label="Provider settings">
      <div style={{ height: headerHeight }}>Authentication</div>
      <button type="button" onClick={() => listRef.current?.scrollToIndex(40, { align: 'start' })}>
        Go to model 40
      </button>
      <DynamicVirtualList
        ref={listRef}
        externalScrollElement={viewport}
        list={items}
        role="list"
        estimateSize={() => 50}
        itemContainerStyle={{ height: 50 }}
        overscan={0}>
        {(item) => <div role="listitem">{item}</div>}
      </DynamicVirtualList>
    </div>
  )
}

describe('DynamicVirtualList with a parent viewport', () => {
  beforeEach(() => {
    headerHeight = 120
    resizeCallbacks.clear()
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(6000)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const viewport = screen.queryByRole('region', { name: 'Provider settings' })
      const top = this.style.position === 'relative' ? headerHeight - (viewport?.scrollTop ?? 0) : 0
      return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 200, width: 400, height: 200, toJSON() {} }
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          this.notify = () => callback([], this)
        }
        private notify: () => void
        observe(element: Element) {
          const callbacks = resizeCallbacks.get(element) ?? new Set<() => void>()
          callbacks.add(this.notify)
          resizeCallbacks.set(element, callbacks)
        }
        unobserve() {}
        disconnect() {
          resizeCallbacks.forEach((callbacks) => callbacks.delete(this.notify))
        }
      }
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: function (this: HTMLElement, options?: ScrollToOptions) {
        if (typeof options === 'object') {
          this.scrollTop = options.top ?? 0
          fireEvent.scroll(this)
        }
      }
    })
  })

  afterEach(() => {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders later models when the surrounding page scrolls', () => {
    render(<Page />)
    expect(screen.getByText('Model 0')).toBeInTheDocument()
    expect(screen.queryByText('Model 12')).not.toBeInTheDocument()

    const viewport = screen.getByRole('region', { name: 'Provider settings' })
    fireEvent.scroll(viewport, { target: { scrollTop: 720 } })

    expect(screen.getByText('Model 12')).toBeInTheDocument()
    expect(screen.queryByText('Model 0')).not.toBeInTheDocument()
    // A second scrolling box would swallow wheel input instead of scrolling the page.
    expect(screen.getByRole('list')).toHaveStyle({ overflow: 'visible' })
  })

  it('keeps model navigation aligned after preceding settings change height', async () => {
    const user = userEvent.setup()
    render(<Page />)
    headerHeight = 300
    act(() => {
      resizeCallbacks.get(screen.getByText('Authentication'))?.forEach((callback) => callback())
    })
    await user.click(screen.getByRole('button', { name: 'Go to model 40' }))

    expect(screen.getByRole('region', { name: 'Provider settings' }).scrollTop).toBe(2300)
    expect(screen.getByText('Model 40')).toBeInTheDocument()
    expect(screen.queryByText('Model 39')).not.toBeInTheDocument()
  })
})
