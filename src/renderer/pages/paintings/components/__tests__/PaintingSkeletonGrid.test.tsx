import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PaintingSkeletonGrid from '../PaintingSkeletonGrid'

type MotionDivProps = {
  children?: ReactNode
  animate?: unknown
  initial?: unknown
  transition?: unknown
  [key: string]: unknown
}

vi.mock('motion/react', () => {
  const MotionDiv = ({ children, animate, initial: _initial, transition, ...props }: MotionDivProps) => {
    void _initial

    return (
      <div data-animate={JSON.stringify(animate)} data-transition={JSON.stringify(transition)} {...props}>
        {children}
      </div>
    )
  }

  return {
    motion: { div: MotionDiv },
    useReducedMotion: () => false
  }
})

describe('PaintingSkeletonGrid', () => {
  const originalResizeObserver = globalThis.ResizeObserver
  let size = { width: 440, height: 440 }
  let resizeCallback: ResizeObserverCallback | undefined
  let observedTarget: Element | undefined

  beforeEach(() => {
    size = { width: 440, height: 440 }
    resizeCallback = undefined
    observedTarget = undefined

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, size.width, size.height)
    )

    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback
        }

        observe(target: Element) {
          observedTarget = target
        }

        unobserve() {}

        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('ResizeObserver', originalResizeObserver)
  })

  it('remounts animation cells when grid geometry changes', () => {
    const { container } = render(<PaintingSkeletonGrid />)
    const root = container.firstElementChild as HTMLElement
    const initialGrid = root.firstElementChild as HTMLElement
    const initialFirstCell = initialGrid.firstElementChild

    expect(initialGrid.children).toHaveLength(10 * 10)
    expect(initialFirstCell).not.toBeNull()
    expect(resizeCallback).toBeDefined()
    expect(observedTarget).toBe(root)

    size = { width: 240, height: 240 }
    act(() => {
      resizeCallback?.([], {} as ResizeObserver)
    })

    const resizedGrid = root.firstElementChild as HTMLElement

    expect(resizedGrid.children).toHaveLength(6 * 6)
    expect(resizedGrid.firstElementChild).not.toBe(initialFirstCell)
  })

  it('varies per-cell lit peaks and phase jitter deterministically', () => {
    const readCells = () => {
      const { container, unmount } = render(<PaintingSkeletonGrid />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement
      // Each cell is a `position: relative` wrapper around the shimmer motion.div
      // (kept even with no tint/slice layers yet, so the shimmer's tree position
      // never changes once they arrive — see the Cell doc comment).
      const cells = Array.from(grid.children).map((wrapper) => wrapper.firstElementChild as HTMLElement)
      const parsed = cells.map((cell) => ({
        animate: JSON.parse(cell.dataset.animate!) as { opacity: number[] },
        transition: JSON.parse(cell.dataset.transition!) as { delay: number }
      }))
      unmount()
      return parsed
    }

    const first = readCells()
    const peaks = first.map((cell) => cell.animate.opacity[2])

    // Peaks stay inside the PEAK_MIN..PEAK_MAX band and genuinely vary per cell.
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(0.35)
      expect(peak).toBeLessThan(0.85)
    }
    expect(new Set(peaks).size).toBeGreaterThan(peaks.length / 2)

    // Jitter scatters delays off the pure diagonal formula: cells on the same
    // diagonal (i and i + cols + 1 share diag in a square grid) no longer tie.
    const cols = 10
    expect(first[0].transition.delay).not.toBe(first[cols + 1].transition.delay)

    // Hash-based noise: a fresh mount reproduces the exact same texture.
    expect(readCells()).toEqual(first)
  })

  describe('real-image slice wave and gap heal (Act 3 & Act 4)', () => {
    // A known-valid sample blurhash (also used elsewhere in the paintings test suite).
    const blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    const cols = 10
    const rows = 10
    const pitch = 42

    it('keeps the loading shimmer mounted and animating underneath the tint layer instead of freezing it', async () => {
      const { container } = render(<PaintingSkeletonGrid blurhash={blurhash} imageUrl="file:///tmp/real.png" />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement

      await waitFor(() => {
        const wrapper = grid.children[0] as HTMLElement
        expect(wrapper.children.length).toBeGreaterThan(1)
      })

      const cellWrapper = grid.children[0] as HTMLElement
      const shimmer = cellWrapper.children[0] as HTMLElement

      // Still the same infinite opacity loop as an untinted cell — a solid
      // colour layer fades in on top of it (asserted below), it never gets
      // replaced by a flat, non-animated colour.
      const animate = JSON.parse(shimmer.dataset.animate!) as { opacity: number[] }
      const transition = JSON.parse(shimmer.dataset.transition!) as { duration: number; repeat: number | null }
      expect(animate.opacity).toHaveLength(5)
      expect(transition.duration).toBe(1.9)
      // JSON has no Infinity — `Number.POSITIVE_INFINITY` round-trips as null.
      expect(transition.repeat).toBeNull()
      expect(shimmer.style.backgroundColor).toBe('currentcolor')
    })

    it('layers a real-image slice on each tinted cell, chasing the tint wave by SLICE_CHASE_OFFSET (0.2s)', async () => {
      const { container } = render(<PaintingSkeletonGrid blurhash={blurhash} imageUrl="file:///tmp/real.png" />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement

      await waitFor(() => {
        const wrapper = grid.children[0] as HTMLElement
        expect(wrapper.children).toHaveLength(3)
      })

      // i = 0 → c = 0, r = 0 → diag = c + (rows - 1 - r) = 9.
      const maxDiag = cols + rows - 2
      const expectedTintDelay = (9 / maxDiag) * 1.35

      const cellWrapper = grid.children[0] as HTMLElement
      const [, tintDiv, sliceDiv] = Array.from(cellWrapper.children) as HTMLElement[]
      const tintTransition = JSON.parse(tintDiv.dataset.transition!) as { delay: number; duration: number }
      const sliceTransition = JSON.parse(sliceDiv.dataset.transition!) as { delay: number; duration: number }

      expect(tintTransition.delay).toBeCloseTo(expectedTintDelay, 5)
      expect(tintTransition.duration).toBe(0.68)
      expect(sliceTransition.delay).toBeCloseTo(expectedTintDelay + 0.2, 5)
      expect(sliceTransition.duration).toBe(0.35)
      expect(sliceDiv.style.backgroundImage).toBe('url("file:///tmp/real.png")')
      expect(sliceDiv.style.backgroundSize).toBe(`${cols * pitch}px ${rows * pitch}px`)
      expect(sliceDiv.style.backgroundPosition).toBe('0px 0px')
    })

    it('fades in a full-image layer over the whole grid once the slice wave finishes sweeping', async () => {
      const { container } = render(<PaintingSkeletonGrid blurhash={blurhash} imageUrl="file:///tmp/real.png" />)
      const root = container.firstElementChild as HTMLElement

      await waitFor(() => expect(root.children).toHaveLength(2))

      const healLayer = root.children[1] as HTMLElement
      const transition = JSON.parse(healLayer.dataset.transition!) as { delay: number; duration: number }

      expect(healLayer.style.backgroundImage).toBe('url("file:///tmp/real.png")')
      expect(healLayer.style.backgroundSize).toBe('cover')
      // HEAL_START = TINT_SWEEP (1.35) + SLICE_CHASE_OFFSET (0.2) + SLICE_FADE_DUR (0.35) = 1.9.
      expect(transition.delay).toBeCloseTo(1.9, 5)
      expect(transition.duration).toBe(0.4)
    })

    it('does not render slice or heal layers without a real image url', async () => {
      const { container } = render(<PaintingSkeletonGrid blurhash={blurhash} />)
      const root = container.firstElementChild as HTMLElement

      await waitFor(() => {
        const grid = root.firstElementChild as HTMLElement
        const wrapper = grid.children[0] as HTMLElement
        // Shimmer + tint layer, no slice layer.
        expect(wrapper.children).toHaveLength(2)
      })

      // Just the grid — no absolutely-positioned heal overlay sibling.
      expect(root.children).toHaveLength(1)
    })

    it('extends onRevealReady to ~2.3s (Act 2 + 3 + 4) when a real image drives the slice + heal sequence', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()
      render(<PaintingSkeletonGrid blurhash={blurhash} imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />)

      // Identify our effect's call by its callback identity — waitFor's own
      // polling schedules unrelated setTimeout calls on the same spy.
      await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(true))

      const call = setTimeoutSpy.mock.calls.find(([fn]) => fn === onRevealReady)!
      expect(call[1]).toBeCloseTo(2300, 0)
      setTimeoutSpy.mockRestore()
    })

    it('keeps the original ~2.03s onRevealReady delay (Act 2 only) without a real image', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()
      render(<PaintingSkeletonGrid blurhash={blurhash} onRevealReady={onRevealReady} />)

      await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(true))

      const call = setTimeoutSpy.mock.calls.find(([fn]) => fn === onRevealReady)!
      expect(call[1]).toBeCloseTo(2030, 0)
      setTimeoutSpy.mockRestore()
    })
  })
})
