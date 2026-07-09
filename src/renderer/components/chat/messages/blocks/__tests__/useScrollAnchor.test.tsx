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

function renderScrollAnchor(isScrollOwned?: () => boolean, releaseScrollOwnership?: () => void) {
  const wrapper = isScrollOwned
    ? ({ children }: { children: ReactNode }) => (
        <ScrollOwnershipProvider isScrollOwned={isScrollOwned} releaseScrollOwnership={releaseScrollOwnership}>
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

  it('takes ownership on expand: releases the runtime, then restores its own scrollTop', () => {
    // Anchor moves up 40px as the expanded block pushes the stream down below it.
    const { anchorEl, scrollTopWrites } = setupScroller({ initialScrollTop: 200, anchorTops: [100, 60] })
    // Runtime owns scroll (bottom-follow) until the block reclaims it on expand.
    let owned = true
    const releaseScrollOwnership = vi.fn(() => {
      owned = false
    })
    const { result } = renderScrollAnchor(() => owned, releaseScrollOwnership)
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update, { takeScrollOwnership: true }))

    expect(releaseScrollOwnership).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    // Ownership was handed back, so the block runs its own restore: 200 + (60 - 100).
    expect(scrollTopWrites).toEqual([160])
  })

  it('yields on expand when the runtime keeps ownership (e.g. an active top-pin)', () => {
    const { anchorEl, scrollTopWrites, rectSpy } = setupScroller()
    // Runtime declines to hand back ownership (a top-pin stays authoritative).
    const releaseScrollOwnership = vi.fn()
    const { result } = renderScrollAnchor(() => true, releaseScrollOwnership)
    result.current.anchorRef.current = anchorEl

    const update = vi.fn()
    act(() => result.current.withScrollAnchor(update, { takeScrollOwnership: true }))

    expect(releaseScrollOwnership).toHaveBeenCalledOnce()
    // Still owned after asking → yield without measuring or writing scrollTop.
    expect(update).toHaveBeenCalledOnce()
    expect(scrollTopWrites).toEqual([])
    expect(rectSpy).not.toHaveBeenCalled()
  })

  it('does not reclaim ownership on collapse (no takeScrollOwnership)', () => {
    const { anchorEl, scrollTopWrites } = setupScroller()
    const releaseScrollOwnership = vi.fn()
    const { result } = renderScrollAnchor(() => true, releaseScrollOwnership)
    result.current.anchorRef.current = anchorEl

    act(() => result.current.withScrollAnchor(vi.fn()))

    // A collapse (default) never asks the runtime to hand back ownership.
    expect(releaseScrollOwnership).not.toHaveBeenCalled()
    expect(scrollTopWrites).toEqual([])
  })

  it('restores scrollTop when no ScrollOwnershipProvider is mounted (standalone default)', () => {
    const { anchorEl, scrollTopWrites } = setupScroller({ initialScrollTop: 200, anchorTops: [100, 60] })
    const { result } = renderScrollAnchor()
    result.current.anchorRef.current = anchorEl

    act(() => result.current.withScrollAnchor(vi.fn()))

    expect(scrollTopWrites).toEqual([160])
  })
})
