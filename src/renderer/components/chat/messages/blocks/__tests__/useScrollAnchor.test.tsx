// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ScrollOwnershipProvider,
  useRequestScrollFollowRecovery,
  useScrollViewportMaxHeight
} from '../ScrollOwnershipContext'
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

function renderScrollAnchor({ runtimeScroller }: { runtimeScroller?: HTMLElement }) {
  const scrollContainerRef = { current: runtimeScroller ?? null }
  const wrapper = runtimeScroller
    ? ({ children }: { children: ReactNode }) => (
        <ScrollOwnershipProvider scrollContainerRef={scrollContainerRef}>{children}</ScrollOwnershipProvider>
      )
    : undefined
  return renderHook(() => useScrollAnchor<HTMLDivElement>(), { wrapper })
}

function renderFollowRecovery({
  anchorEl,
  runtimeScroller,
  requestFollowRecovery
}: {
  anchorEl?: HTMLDivElement
  runtimeScroller: HTMLElement
  requestFollowRecovery: () => void
}) {
  const anchorRef = anchorEl ? { current: anchorEl } : undefined
  const scrollContainerRef = { current: runtimeScroller }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ScrollOwnershipProvider scrollContainerRef={scrollContainerRef} requestFollowRecovery={requestFollowRecovery}>
      {children}
    </ScrollOwnershipProvider>
  )
  return renderHook(() => useRequestScrollFollowRecovery(anchorRef), { wrapper })
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

  it('requests follow recovery only for DOM content inside the runtime scroller', () => {
    const runtime = setupScroller()
    const nested = setupScroller()
    const portal = setupScroller()
    runtime.scroller.appendChild(nested.scroller)
    const requestFollowRecovery = vi.fn()
    const owned = renderFollowRecovery({
      anchorEl: runtime.anchorEl,
      runtimeScroller: runtime.scroller,
      requestFollowRecovery
    })
    const nestedContent = renderFollowRecovery({
      anchorEl: nested.anchorEl,
      runtimeScroller: runtime.scroller,
      requestFollowRecovery
    })
    const separate = renderFollowRecovery({
      anchorEl: portal.anchorEl,
      runtimeScroller: runtime.scroller,
      requestFollowRecovery
    })

    act(() => owned.result.current())
    act(() => nestedContent.result.current())
    act(() => separate.result.current())

    expect(requestFollowRecovery).toHaveBeenCalledTimes(2)
  })

  it('preserves context-only recovery for lifecycle transitions without a local anchor', () => {
    const runtime = setupScroller()
    const requestFollowRecovery = vi.fn()
    const lifecycleRecovery = renderFollowRecovery({
      runtimeScroller: runtime.scroller,
      requestFollowRecovery
    })

    act(() => lifecycleRecovery.result.current())

    expect(requestFollowRecovery).toHaveBeenCalledOnce()
  })

  it.each([
    ['caps to half of the viewport left after the bottom inset', 300, 200],
    ['uses the real remaining space below the trigger', 550, 146]
  ])('%s', (_label, triggerBottom, expectedHeight) => {
    const { scroller, anchorEl, rectSpy } = setupScroller()
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ bottom: 800 } as DOMRect)
    rectSpy.mockReturnValue({ bottom: triggerBottom } as DOMRect)
    const scrollContainerRef = { current: scroller }
    const triggerRef = { current: anchorEl }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ScrollOwnershipProvider scrollContainerRef={scrollContainerRef} viewportBottomInset={100}>
        {children}
      </ScrollOwnershipProvider>
    )
    const { result } = renderHook(
      () =>
        useScrollViewportMaxHeight(triggerRef, {
          bottomGap: 4,
          enabled: true,
          maxViewportRatio: 0.5,
          minHeight: 120
        }),
      { wrapper }
    )

    expect(result.current).toBe(expectedHeight)
  })
})
