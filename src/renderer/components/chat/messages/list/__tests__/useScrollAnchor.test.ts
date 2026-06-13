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

  it('keeps pinned spacer stable until real scroller height can hold the anchored viewport', () => {
    const scroller = document.createElement('div')
    let scrollHeight = 420
    let canRelease = false
    setElementMetric(scroller, 'clientHeight', () => 400)
    setElementMetric(scroller, 'scrollHeight', () => scrollHeight)

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

    act(() => result.current.pinTo(2))
    expect(result.current.spacerHeight).toBe(400)

    flushRaf()
    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })

    scrollHeight = 780
    act(() => result.current.onContentSizeChange())

    expect(result.current.spacerHeight).toBe(400)

    scrollHeight = 1100
    act(() => result.current.onContentSizeChange())

    expect(result.current.spacerHeight).toBe(400)

    canRelease = true
    act(() => result.current.onContentSizeChange())

    expect(result.current.spacerHeight).toBe(0)
  })
})
