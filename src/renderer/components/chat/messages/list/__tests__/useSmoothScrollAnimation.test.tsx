// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSmoothScrollAnimation } from '../useSmoothScrollAnimation'

interface FakeRaf {
  raf: (cb: FrameRequestCallback) => number
  caf: (id: number) => void
  /** Advance N frames, invoking pending callbacks synchronously. */
  tick(frames: number): void
  /** Number of frames in the queue. */
  pending(): number
}

function createFakeRaf(): FakeRaf {
  let nextId = 1
  let queue = new Map<number, FrameRequestCallback>()

  return {
    raf(cb) {
      const id = nextId++
      queue.set(id, cb)
      return id
    },
    caf(id) {
      queue.delete(id)
    },
    tick(frames) {
      for (let i = 0; i < frames; i++) {
        if (queue.size === 0) return
        const current = queue
        queue = new Map()
        for (const cb of current.values()) cb(performance.now())
      }
    },
    pending() {
      return queue.size
    }
  }
}

function setupAnimationHarness(initialScrollTop = 0) {
  const scroller = document.createElement('div')
  Object.defineProperty(scroller, 'scrollTop', {
    get() {
      return (scroller as unknown as { _scrollTop: number })._scrollTop ?? 0
    },
    set(value: number) {
      ;(scroller as unknown as { _scrollTop: number })._scrollTop = value
    },
    configurable: true
  })
  scroller.scrollTop = initialScrollTop
  const fake = createFakeRaf()

  const { result, unmount } = renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(scroller as unknown as HTMLDivElement)
    return useSmoothScrollAnimation(ref, { raf: fake.raf, caf: fake.caf })
  })

  return { scroller, fake, result, unmount }
}

describe('useSmoothScrollAnimation', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('does nothing when scrollerRef is null', () => {
    const fake = createFakeRaf()
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement | null>(null)
      return useSmoothScrollAnimation(ref, { raf: fake.raf, caf: fake.caf })
    })
    expect(() => result.current.scrollTo(() => 100)).not.toThrow()
    expect(fake.pending()).toBe(0)
  })

  it('progresses scrollTop frame by frame and ends exactly at the target', () => {
    const { scroller, fake, result } = setupAnimationHarness(0)

    act(() => {
      result.current.scrollTo(() => 1000, { frames: 5, easing: (t) => t })
    })

    // Frame 1 → 200
    act(() => fake.tick(1))
    expect(scroller.scrollTop).toBeCloseTo(200, 1)

    act(() => fake.tick(1))
    expect(scroller.scrollTop).toBeCloseTo(400, 1)

    act(() => fake.tick(1))
    expect(scroller.scrollTop).toBeCloseTo(600, 1)

    act(() => fake.tick(2))
    expect(scroller.scrollTop).toBe(1000)
    expect(result.current.isAnimating()).toBe(false)
    expect(fake.pending()).toBe(0)
  })

  it('resamples the target on each frame so a moving destination is followed', () => {
    const { scroller, fake, result } = setupAnimationHarness(0)
    let target = 500

    act(() => {
      result.current.scrollTo(() => target, { frames: 4, easing: (t) => t })
    })

    act(() => fake.tick(1)) // 25% of (500-0) = 125
    expect(scroller.scrollTop).toBeCloseTo(125, 1)

    target = 1000 // destination grows mid-animation

    act(() => fake.tick(1)) // 50% of (1000-0) = 500
    expect(scroller.scrollTop).toBeCloseTo(500, 1)

    act(() => fake.tick(2))
    expect(scroller.scrollTop).toBe(1000) // final snap to live target
  })

  it('follows a moving target without restarting from the original offset', () => {
    const { scroller, fake, result } = setupAnimationHarness(0)
    let target = 500

    act(() => {
      result.current.followTo(() => target, { maxStep: 100, minStep: 10, damping: 1 })
    })

    act(() => fake.tick(1))
    expect(scroller.scrollTop).toBe(100)

    target = 800

    act(() => fake.tick(1))
    expect(scroller.scrollTop).toBe(200)

    act(() => fake.tick(10))
    expect(scroller.scrollTop).toBe(800)
    expect(result.current.isAnimating()).toBe(false)
    expect(fake.pending()).toBe(0)
  })

  it('cancel() stops the animation and clears the pending frame', () => {
    const { fake, result, scroller } = setupAnimationHarness(0)
    act(() => {
      result.current.scrollTo(() => 1000, { frames: 10, easing: (t) => t })
    })
    act(() => fake.tick(2))
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(result.current.isAnimating()).toBe(true)

    act(() => result.current.cancel())
    expect(result.current.isAnimating()).toBe(false)
    expect(fake.pending()).toBe(0)

    const stoppedAt = scroller.scrollTop
    act(() => fake.tick(10))
    expect(scroller.scrollTop).toBe(stoppedAt)
  })

  it('starting a new scrollTo cancels the previous animation', () => {
    const { fake, result, scroller } = setupAnimationHarness(0)
    act(() => result.current.scrollTo(() => 1000, { frames: 10, easing: (t) => t }))
    act(() => fake.tick(2))
    const before = scroller.scrollTop

    act(() => result.current.scrollTo(() => 2000, { frames: 4, easing: (t) => t }))
    // First animation cancelled — there should be only the new frame queued.
    expect(fake.pending()).toBe(1)

    act(() => fake.tick(4))
    expect(scroller.scrollTop).toBe(2000)
    expect(scroller.scrollTop).toBeGreaterThan(before)
  })

  it('unmount cancels in-flight animation', () => {
    const { fake, result, unmount } = setupAnimationHarness(0)
    act(() => result.current.scrollTo(() => 1000, { frames: 10, easing: (t) => t }))
    expect(fake.pending()).toBe(1)
    unmount()
    expect(fake.pending()).toBe(0)
  })
})
