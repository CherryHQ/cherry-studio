import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import type { VListHandle } from 'virtua'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useScrollAnchor } from '../useScrollAnchor'
import type { SmoothScrollController } from '../useSmoothScrollAnimation'

function setElementMetric(element: HTMLElement, name: 'clientHeight' | 'scrollHeight', getValue: () => number): void {
  Object.defineProperty(element, name, {
    configurable: true,
    get: getValue
  })
}

describe('useScrollAnchor', () => {
  let rafQueue: Array<() => void>

  const flushRaf = () => {
    const batch = rafQueue
    rafQueue = []
    act(() => batch.forEach((fn) => fn()))
  }

  beforeEach(() => {
    rafQueue = []
    let rafId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0))
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('over-allocates, tightens to the exact room, holds while short, releases on overflow', () => {
    const scroller = document.createElement('div')
    let contentHeight = 420
    setElementMetric(scroller, 'clientHeight', () => 400)
    // DOM scrollHeight = real content + the rendered spacer (itself a virtua item).
    setElementMetric(scroller, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    const handle = {
      getItemOffset: vi.fn(() => 300),
      scrollSize: 700,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll
      })
    )

    // On pin the spacer is over-allocated to a full viewport (400) so the
    // message reliably reaches the top even before virtua has measured — NOT the
    // tight needed (300 + 400 - 420 = 280).
    act(() => result.current.pinTo(2))
    expect(result.current.spacerHeight).toBe(400)

    flushRaf()
    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })

    // Content stable (a measurement settle): tighten down to needed = 280 so the
    // scrollbar rests at the bottom.
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(280)

    // Reply streams in but still fits below the pin (needed = 300 + 400 - 500 =
    // 200 > 0): hold the spacer, do not shrink per chunk.
    contentHeight = 500
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(280)
    expect(result.current.isPinned()).toBe(true)

    // Reply outgrows the space below the pin (needed = 300 + 400 - 900 = 0):
    // release so the turn can hand off to bottom-follow, even mid-stream.
    contentHeight = 900
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(0)
    expect(result.current.isPinned()).toBe(false)
  })

  it('tightens the full-viewport bootstrap spacer after the first tall-viewport measurement', () => {
    const scroller = document.createElement('div')
    const content = document.createElement('div')
    let contentHeight = 420
    setElementMetric(scroller, 'clientHeight', () => 900)
    setElementMetric(scroller, 'scrollHeight', () => contentHeight + result.current.spacerHeight)
    setElementMetric(content, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    const handle = {
      getItemOffset: vi.fn(() => 300),
      scrollSize: 700,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        contentRef: { current: content } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll
      })
    )

    act(() => result.current.pinTo(2))
    expect(result.current.spacerHeight).toBe(900)

    flushRaf()

    // First measurement grows the natural size; tighten the bootstrap spacer once
    // anyway (needed = 300 + 900 - 900 = 300).
    contentHeight = 900
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(300)

    // Still fits below the pin (needed = 300 + 900 - 1000 = 200 > 0): hold.
    contentHeight = 1000
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(300)
    expect(result.current.isPinned()).toBe(true)

    // Overflows (needed = 300 + 900 - 1200 = 0): release for bottom-follow.
    contentHeight = 1200
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(0)
    expect(result.current.isPinned()).toBe(false)
  })

  it('keeps the pin when virtua jump-compensates for items measured above the viewport', () => {
    const scroller = document.createElement('div')
    setElementMetric(scroller, 'clientHeight', () => 2000)
    setElementMetric(scroller, 'scrollHeight', () => 2400 + result.current.spacerHeight)

    // virtua's measured offset of the pinned item. Buffered history above it is
    // initially sized from the per-item estimate; measuring it shorter lowers
    // this offset (and virtua lowers scrollTop by the same delta).
    let itemOffset = 1800
    const handle = {
      getItemOffset: vi.fn(() => itemOffset),
      scrollSize: 2200,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll
      })
    )

    act(() => result.current.pinTo(3))
    flushRaf()
    expect(result.current.isPinned()).toBe(true)

    // Buffered history above the anchor is measured shorter than its estimate, so
    // virtua lowers both the item offset and scrollTop by the same ~500px delta.
    // This measurement jump must NOT be mistaken for the user scrolling away.
    itemOffset = 1300
    act(() => result.current.onUserScroll(1300, false))
    expect(result.current.isPinned()).toBe(true)

    // A programmatic scroll that DOES deviate from the anchor (e.g. a child
    // scrollIntoView) is flagged non-user: it must not release the pin.
    act(() => result.current.onUserScroll(1100, false))
    expect(result.current.isPinned()).toBe(true)

    // A genuine user scroll (isUserInitiated) away from the anchor releases it.
    act(() => result.current.onUserScroll(1100, true))
    expect(result.current.isPinned()).toBe(false)
  })

  it('reserves startMargin in the spacer so the top padding does not clamp the pinned message', () => {
    const scroller = document.createElement('div')
    const contentHeight = 420
    setElementMetric(scroller, 'clientHeight', () => 400)
    setElementMetric(scroller, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    const handle = {
      getItemOffset: vi.fn(() => 300),
      scrollSize: 700,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll,
        // The top padding spacer rendered before virtua: scrollToIndex lands at
        // startMargin + getItemOffset, so the spacer must account for it.
        startMargin: 50
      })
    )

    act(() => result.current.pinTo(2))
    flushRaf()

    // needed = (50 + 300) + 400 - 420 = 330. Omitting startMargin would tighten to
    // 280, leaving scrollSize 50px short of the pinned scrollTop — the browser would
    // clamp it and the message (with the history above) drifts down by the padding.
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(330)
  })

  it('re-asserts scrollTop back to the anchor when a programmatic scroll drifts the pinned message', () => {
    const scroller = document.createElement('div')
    const contentHeight = 500
    let animating = false
    setElementMetric(scroller, 'clientHeight', () => 400)
    setElementMetric(scroller, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    const handle = {
      getItemOffset: vi.fn(() => 300),
      scrollSize: 700,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => animating),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll
      })
    )

    act(() => result.current.pinTo(2))
    flushRaf()
    expect(result.current.isPinned()).toBe(true)

    // A programmatic scroll (virtua remeasure / scrollIntoView) drifts scrollTop
    // forward off the anchor (300) by more than REASSERT_TOLERANCE_PX → snapped back.
    scroller.scrollTop = 380
    act(() => result.current.onContentSizeChange())
    expect(scroller.scrollTop).toBe(300)
    expect(result.current.isPinned()).toBe(true)

    // Within tolerance (≤ 2px) → left untouched, no churn.
    scroller.scrollTop = 301
    act(() => result.current.onContentSizeChange())
    expect(scroller.scrollTop).toBe(301)

    // While a smooth scroll is animating → never fight it, do not re-assert.
    scroller.scrollTop = 380
    animating = true
    act(() => result.current.onContentSizeChange())
    expect(scroller.scrollTop).toBe(380)
  })

  it('drops the spacer and releases when the pinned item sits at the virtualizer top under a tall start margin (M1)', () => {
    const scroller = document.createElement('div')
    const contentHeight = 300
    setElementMetric(scroller, 'clientHeight', () => 900)
    setElementMetric(scroller, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    // First message of an empty conversation: getItemOffset ≈ 0. With a floating
    // navbar startMargin is ~44, so anchorOffset ≈ 44. A fixed near-top threshold
    // of 24 would never fire (the regression); it must scale with startMargin.
    const handle = {
      getItemOffset: vi.fn(() => 0),
      scrollSize: 300,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll,
        startMargin: 44
      })
    )

    act(() => result.current.pinTo(0))
    flushRaf()

    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(0)
    expect(result.current.isPinned()).toBe(false)
  })

  it('measures natural size from contentRef, dodging the scroller scrollHeight floor (L4)', () => {
    const scroller = document.createElement('div')
    const content = document.createElement('div')
    const contentHeight = 200
    setElementMetric(scroller, 'clientHeight', () => 900)
    // The scroller floors scrollHeight to clientHeight when content is short; the
    // inner content wrapper does not. The spacer math must use the real (short)
    // content height, not the floored scroller value.
    setElementMetric(scroller, 'scrollHeight', () => Math.max(900, contentHeight + result.current.spacerHeight))
    setElementMetric(content, 'scrollHeight', () => contentHeight + result.current.spacerHeight)

    const handle = {
      getItemOffset: vi.fn(() => 160),
      scrollSize: 200,
      scrollToIndex: vi.fn()
    } as unknown as VListHandle
    const smoothScroll: SmoothScrollController = {
      cancel: vi.fn(),
      followTo: vi.fn(),
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        contentRef: { current: content } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll,
        startMargin: 44
      })
    )

    // anchorOffset = 44 + 160 = 204; natural via content = 200 (NOT the 900 floor).
    // needed = 204 + 900 - 200 = 904 → over-allocated to 904. Using the floored
    // scroller height (900) would instead yield needed = 204 → spacer 900.
    act(() => result.current.pinTo(0))
    expect(result.current.spacerHeight).toBe(904)
  })
})
