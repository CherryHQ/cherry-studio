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

function renderScrollAnchor(isScrollOwned?: () => boolean) {
  const wrapper = isScrollOwned
    ? ({ children }: { children: ReactNode }) => (
        <ScrollOwnershipProvider isScrollOwned={isScrollOwned}>{children}</ScrollOwnershipProvider>
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('restores scrollTop after a toggle when the runtime does not own scroll', () => {
    // Anchor moves up 40px (200 -> 160) as content above it collapses.
    const { anchorEl, scrollTopWrites } = setupScroller({ initialScrollTop: 200, anchorTops: [100, 60] })
    const { result } = renderScrollAnchor(() => false)
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update))

    expect(update).toHaveBeenCalledOnce()
    // scrollBefore(200) + drift(60 - 100) = 160
    expect(scrollTopWrites).toEqual([160])
  })

  it('yields without writing scrollTop while the runtime owns scroll', () => {
    const { anchorEl, scrollTopWrites, rectSpy } = setupScroller()
    const { result } = renderScrollAnchor(() => true)
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update))

    // The toggle still applies, but we don't touch scrollTop or even measure —
    // the runtime is the sole scroll owner during streaming / bottom-follow.
    expect(update).toHaveBeenCalledOnce()
    expect(scrollTopWrites).toEqual([])
    expect(rectSpy).not.toHaveBeenCalled()
  })

  it('restores scrollTop when no ScrollOwnershipProvider is mounted (standalone default)', () => {
    const { anchorEl, scrollTopWrites } = setupScroller({ initialScrollTop: 200, anchorTops: [100, 60] })
    const { result } = renderScrollAnchor()
    result.current.anchorRef.current = anchorEl

    act(() => result.current.withScrollAnchor(vi.fn()))

    expect(scrollTopWrites).toEqual([160])
  })
})
