import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { Virtualizer } from 'virtua'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useChatVirtualizerRuntime } from '../chatVirtualizerRuntime'

const resizeObservers = new Map<ResizeObserver, { callback: ResizeObserverCallback; targets: Set<Element> }>()

function MessageDisclosure({ index }: { index: number }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      Message {index}
    </button>
  )
}

const getItemKey = (index: number) => String(index)

function Conversation({ count }: { count: number }) {
  const runtime = useChatVirtualizerRuntime({
    items: Array.from({ length: count }, (_, index) => index),
    getItemKey,
    renderItem: (index) => <MessageDisclosure index={index} />,
    hasMoreTop: false,
    topReachOverscanItems: 6,
    bottomPadding: 0
  })
  const { scrollToBottom } = runtime
  useEffect(() => scrollToBottom(), [count, scrollToBottom])
  return (
    <div ref={runtime.scrollerRef} role="region" aria-label="Messages">
      <div ref={runtime.contentRef} data-content>
        <Virtualizer
          ref={runtime.vlistHandleRef}
          scrollRef={runtime.scrollerRef}
          data={runtime.wrappedItems}
          itemSize={400}
          bufferSize={2400}
          onScroll={runtime.scrollerProps.onScroll}
          onScrollEnd={runtime.scrollerProps.onScrollEnd}>
          {runtime.wrappedRenderItem}
        </Virtualizer>
      </div>
      <div ref={runtime.freezeSpacerRef} />
    </div>
  )
}

async function measureViewport() {
  await act(async () => {
    await Promise.resolve()
    for (const [observer, { callback, targets }] of resizeObservers) {
      const entries = Array.from(targets, (target) => ({
        target,
        contentRect: new DOMRect(
          0,
          0,
          600,
          target.hasAttribute('data-content')
            ? target.scrollHeight
            : target.getAttribute('role') === 'region'
              ? 400
              : 100
        ),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: []
      }))
      callback(entries, observer)
    }
  })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    const list = this.querySelector<HTMLElement>('[style*="contain: size"]')
    return Math.max(400, Number.parseFloat(list?.style.height ?? '0'))
  })
  const scrollOffsets = new WeakMap<Element, number>()
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
    return scrollOffsets.get(this) ?? 0
  })
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, offset: number) {
    const next = Math.max(0, Math.min(offset, this.scrollHeight - this.clientHeight))
    if (next === (scrollOffsets.get(this) ?? 0)) return
    scrollOffsets.set(this, next)
    queueMicrotask(() => fireEvent.scroll(this))
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop
    }
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly targets = new Set<Element>()
      constructor(callback: ResizeObserverCallback) {
        resizeObservers.set(this, { callback, targets: this.targets })
      }
      observe(target: Element) {
        this.targets.add(target)
      }
      unobserve(target: Element) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    }
  )
})

afterEach(() => {
  resizeObservers.clear()
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('preserves an expanded history message while following an appended turn through measurement', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<Conversation count={8} />)
  await measureViewport()
  await measureViewport()
  await measureViewport()
  await waitFor(() =>
    expect(getComputedStyle(screen.getByRole('button', { name: 'Message 7' })).pointerEvents).not.toBe('none')
  )
  await user.click(screen.getByRole('button', { name: 'Message 7' }))

  rerender(<Conversation count={10} />)
  await measureViewport()
  await measureViewport()
  await measureViewport()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Message 7' })).toHaveAttribute('aria-expanded', 'true')
  )
  const scroller = screen.getByRole('region', { name: 'Messages' })
  await waitFor(() => expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight))
})
