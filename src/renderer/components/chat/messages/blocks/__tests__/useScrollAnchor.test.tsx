// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScrollOwnershipProvider } from '../ScrollOwnershipContext'
import { useScrollAnchor } from '../useScrollAnchor'

/**
 * Builds a real scrollable ancestor + anchor child so `findScrollParent`
 * resolves and `scrollTop` writes are observable. Records every `scrollTop`
 * write and drives `getBoundingClientRect` from `anchorTops` (one entry per
 * call: before-update, then after-update).
 */
function setupScroller({
  initialScrollTop = 200,
  anchorTops = [100, 100]
}: {
  initialScrollTop?: number
  anchorTops?: number[]
} = {}) {
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true })

  const scrollTopWrites: number[] = []
  let scrollTop = initialScrollTop
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
      scrollTopWrites.push(value)
    }
  })

  const anchorEl = document.createElement('div')
  let rectCall = 0
  const rectSpy = vi.spyOn(anchorEl, 'getBoundingClientRect').mockImplementation(() => {
    const top = anchorTops[Math.min(rectCall, anchorTops.length - 1)]
    rectCall += 1
    return { top } as DOMRect
  })
  scroller.appendChild(anchorEl)
  document.body.appendChild(scroller)

  return { scroller, anchorEl, scrollTopWrites, rectSpy }
}

function renderScrollAnchor({
  runtimeScroller,
  requestReadingControl
}: {
  runtimeScroller?: HTMLElement
  requestReadingControl?: (anchor: HTMLElement | null) => void
}) {
  const scrollContainerRef = { current: runtimeScroller ?? null }
  const wrapper = runtimeScroller
    ? ({ children }: { children: ReactNode }) => (
        <ScrollOwnershipProvider scrollContainerRef={scrollContainerRef} requestReadingControl={requestReadingControl}>
          {children}
        </ScrollOwnershipProvider>
      )
    : undefined
  return renderHook(() => useScrollAnchor<HTMLDivElement>(), { wrapper })
}

describe('useScrollAnchor', () => {
  beforeEach(() => {
    // Run the restore rAF synchronously so its scrollTop write lands inside act().
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('applies the update without measuring or writing scrollTop inside the message list', () => {
    const { scroller, anchorEl, scrollTopWrites, rectSpy } = setupScroller()
    const { result } = renderScrollAnchor({ runtimeScroller: scroller })
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update))

    // The runtime owns scroll stability inside the list — whether it is driving
    // (pin / bottom-follow) or freezing the viewport after a user takeover, a
    // second scrollTop writer here is what used to jitter the scrollbar.
    expect(update).toHaveBeenCalledOnce()
    expect(scrollTopWrites).toEqual([])
    expect(rectSpy).not.toHaveBeenCalled()
  })

  it('hands an explicitly opened disclosure to the runtime without writing scrollTop locally', () => {
    const { scroller, anchorEl, scrollTopWrites } = setupScroller()
    const requestReadingControl = vi.fn()
    const { result } = renderScrollAnchor({ runtimeScroller: scroller, requestReadingControl })
    result.current.anchorRef.current = anchorEl

    act(() => result.current.withScrollAnchor(vi.fn(), { enterReadingMode: true }))

    expect(requestReadingControl).toHaveBeenCalledWith(anchorEl)
    expect(scrollTopWrites).toEqual([])
  })

  it('restores scrollTop after a toggle when standalone (no provider)', () => {
    // Anchor moves up 40px (200 -> 160) as content above it collapses.
    const { anchorEl, scrollTopWrites } = setupScroller({ initialScrollTop: 200, anchorTops: [100, 60] })
    const { result } = renderScrollAnchor({})
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update))

    expect(update).toHaveBeenCalledOnce()
    // scrollBefore(200) + drift(60 - 100) = 160
    expect(scrollTopWrites).toEqual([160])
  })

  it('applies a final correction after an animated disclosure settles', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const { anchorEl, scrollTopWrites } = setupScroller({
      initialScrollTop: 200,
      anchorTops: [100, 100, 60]
    })
    const { result } = renderScrollAnchor({})
    result.current.anchorRef.current = anchorEl

    act(() => result.current.withScrollAnchor(vi.fn(), { settleAfterMs: 220 }))
    expect(scrollTopWrites).toEqual([200])

    act(() => {
      vi.advanceTimersByTime(220)
    })
    expect(scrollTopWrites).toEqual([200, 160])
  })

  it('applies the update without writes when standalone but no anchor element is attached', () => {
    const { scrollTopWrites } = setupScroller()
    const { result } = renderScrollAnchor({})

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update))

    expect(update).toHaveBeenCalledOnce()
    expect(scrollTopWrites).toEqual([])
  })

  it('keeps local compensation for a nested scroller inside the managed list', () => {
    const runtime = setupScroller()
    const nested = setupScroller({ initialScrollTop: 80, anchorTops: [120, 90] })
    runtime.scroller.appendChild(nested.scroller)
    const { result } = renderScrollAnchor({ runtimeScroller: runtime.scroller })
    result.current.anchorRef.current = nested.anchorEl

    act(() => result.current.withScrollAnchor(vi.fn()))

    expect(nested.scrollTopWrites).toEqual([50])
    expect(runtime.scrollTopWrites).toEqual([])
  })

  it('keeps local compensation when context reaches a separate portal scroller', () => {
    const runtime = setupScroller()
    const portal = setupScroller({ initialScrollTop: 140, anchorTops: [80, 110] })
    const { result } = renderScrollAnchor({ runtimeScroller: runtime.scroller })
    result.current.anchorRef.current = portal.anchorEl

    act(() => result.current.withScrollAnchor(vi.fn()))

    expect(portal.scrollTopWrites).toEqual([170])
    expect(runtime.scrollTopWrites).toEqual([])
  })
})
