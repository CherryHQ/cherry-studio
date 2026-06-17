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

  it('over-allocates the pinned spacer, then tightens to the exact room once content settles', () => {
    const scroller = document.createElement('div')
    let contentHeight = 420
    let canRelease = false
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
      isAnimating: vi.fn(() => false),
      scrollTo: vi.fn()
    }

    const { result } = renderHook(() =>
      useScrollAnchor({
        scrollerRef: { current: scroller } as RefObject<HTMLElement | null>,
        vlistHandleRef: { current: handle } as RefObject<VListHandle | null>,
        smoothScroll,
        canRelease: () => canRelease
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

    // Reply streams in (content grows): hold the spacer, do not shrink per chunk.
    contentHeight = 900
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(280)

    // Streaming finished and the lock opened: needed is now 0, reclaim the spacer.
    canRelease = true
    act(() => result.current.onContentSizeChange())
    expect(result.current.spacerHeight).toBe(0)
  })
})
