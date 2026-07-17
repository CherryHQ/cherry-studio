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

// Mutable so individual tests can flip prefers-reduced-motion on.
const reduceMotionState = vi.hoisted(() => ({ value: false }))
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
    useReducedMotion: () => reduceMotionState.value
  }
})

// The tint colours are downsampled from the real image, so the grid pulls the
// image bytes through `getImageBlobFromSource` and draws them into a cols×rows
// canvas. The stubs below feed it a deterministic solid colour per cell.
const mockGetImageBlobFromSource = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/image', () => ({
  getImageBlobFromSource: mockGetImageBlobFromSource
}))

// Every downsampled cell resolves to this colour (the default stubbed getImageData).
const TINT_COLOR = 'rgb(10, 20, 30)'

/** An ImageData-like buffer filled with a single solid RGB for every pixel. */
const solidImageData = (w: number, h: number, [r, g, b]: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = r
    data[p * 4 + 1] = g
    data[p * 4 + 2] = b
    data[p * 4 + 3] = 255
  }
  return { data }
}

describe('PaintingSkeletonGrid', () => {
  let size = { width: 440, height: 440 }
  let resizeCallback: ResizeObserverCallback | undefined
  let observedTarget: Element | undefined
  let drawImageMock: ReturnType<typeof vi.fn>
  let getImageDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    reduceMotionState.value = false
    size = { width: 440, height: 440 }
    resizeCallback = undefined
    observedTarget = undefined

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, size.width, size.height)
    )

    mockGetImageBlobFromSource.mockReset().mockResolvedValue(new Blob())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 64, height: 64, close: vi.fn() }))
    drawImageMock = vi.fn()
    getImageDataMock = vi.fn((_x: number, _y: number, w: number, h: number) => solidImageData(w, h, [10, 20, 30]))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: drawImageMock,
      getImageData: getImageDataMock
    } as never)

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
    vi.unstubAllGlobals()
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
    const cols = 10
    const rows = 10
    // The 440px box insets by GAP (5) on each side → a 430px inner square divided
    // into 10 columns: cell = (430 - 9*5) / 10 = 38.5, so the pitch (cell + gap) is
    // 43.5 and the shared slice canvas spans cols * pitch = 435px.
    const pitch = 43.5

    it('keeps the loading shimmer mounted and animating underneath the tint layer instead of freezing it', async () => {
      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
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
      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
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

      // The tint layer carries the downsampled cell colour.
      expect(tintDiv.style.backgroundColor).toBe(TINT_COLOR)
      expect(tintTransition.delay).toBeCloseTo(expectedTintDelay, 5)
      expect(tintTransition.duration).toBe(0.68)
      expect(sliceTransition.delay).toBeCloseTo(expectedTintDelay + 0.2, 5)
      expect(sliceTransition.duration).toBe(0.35)
      expect(sliceDiv.style.backgroundImage).toBe('url("file:///tmp/real.png")')
      expect(sliceDiv.style.backgroundSize).toBe(`${cols * pitch}px ${rows * pitch}px`)
      expect(sliceDiv.style.backgroundPosition).toBe('0px 0px')
    })

    it('fades in a full-image layer over the whole grid once the slice wave finishes sweeping', async () => {
      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
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

    it('does not tint, slice, or heal without a real image url', () => {
      const { container } = render(<PaintingSkeletonGrid />)
      const root = container.firstElementChild as HTMLElement
      const grid = root.firstElementChild as HTMLElement
      const wrapper = grid.children[0] as HTMLElement

      // Only the shimmer — the tint is downsampled from the image, so with no
      // image url there is no tint layer, no slice layer, and no heal overlay.
      expect(wrapper.children).toHaveLength(1)
      expect(root.children).toHaveLength(1)
    })

    it('extends onRevealReady to ~2.3s (Act 2 + 3 + 4) when a real image drives the slice + heal sequence', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()
      render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />)

      // Identify our effect's call by its callback identity — waitFor's own
      // polling schedules unrelated setTimeout calls on the same spy.
      await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(true))

      const call = setTimeoutSpy.mock.calls.find(([fn]) => fn === onRevealReady)!
      expect(call[1]).toBeCloseTo(2300, 0)
      setTimeoutSpy.mockRestore()
    })

    it('uses the ~2.03s onRevealReady delay (Act 2 only) without a real image', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()
      render(<PaintingSkeletonGrid onRevealReady={onRevealReady} />)

      await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(true))

      const call = setTimeoutSpy.mock.calls.find(([fn]) => fn === onRevealReady)!
      expect(call[1]).toBeCloseTo(2030, 0)
      setTimeoutSpy.mockRestore()
    })
  })

  describe('image downsampling', () => {
    it('draws the image into a cols×rows canvas and maps pixels row-major to per-cell tints', async () => {
      // A distinct colour per pixel index makes the row-major mapping observable:
      // pixel p → rgb(p, 0, 0), which cell i must pick up as its own tint.
      getImageDataMock.mockImplementation((_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let p = 0; p < w * h; p++) {
          data[p * 4] = p
          data[p * 4 + 3] = 255
        }
        return { data }
      })

      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement

      await waitFor(() => {
        // The tint layer only appears once the downsample resolves.
        expect((grid.children[0] as HTMLElement).children).toHaveLength(3)
      })

      // The canvas is sized to the measured 10×10 grid: the full bitmap is scaled
      // into it and read back at exactly those dimensions (not a fixed thumbnail).
      expect(drawImageMock).toHaveBeenCalledWith(expect.anything(), 0, 0, 10, 10)
      expect(getImageDataMock).toHaveBeenCalledWith(0, 0, 10, 10)

      const tintOf = (cellIndex: number) =>
        ((grid.children[cellIndex] as HTMLElement).children[1] as HTMLElement).style.backgroundColor
      // Row-major: cell 0 ← pixel 0, cell 1 ← pixel 1, cell 11 ← pixel 11.
      expect(tintOf(0)).toBe('rgb(0, 0, 0)')
      expect(tintOf(1)).toBe('rgb(1, 0, 0)')
      expect(tintOf(11)).toBe('rgb(11, 0, 0)')
    })

    it('re-downsamples at the new geometry when the grid relocks', async () => {
      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
      const root = container.firstElementChild as HTMLElement

      // Initial downsample against the measured 10×10 grid.
      await waitFor(() => expect(getImageDataMock).toHaveBeenCalledWith(0, 0, 10, 10))

      // The box relocks to a smaller natural size → the grid re-measures to 6×6, so
      // the colour effect must re-run to match the tint count to the new layout.
      size = { width: 240, height: 240 }
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })

      await waitFor(() => expect(getImageDataMock).toHaveBeenCalledWith(0, 0, 6, 6))
      expect((root.firstElementChild as HTMLElement).children).toHaveLength(6 * 6)
    })

    it('discards a stale in-flight downsample when the grid relocks before it resolves', async () => {
      // Gate the first (10×10) downsample so it is still in flight when the grid
      // relocks; the second (6×6) downsample resolves immediately. Colours are keyed
      // by canvas width so the two passes stay distinguishable regardless of order.
      let releaseFirst: (blob: Blob) => void = () => {}
      mockGetImageBlobFromSource.mockReturnValueOnce(new Promise<Blob>((resolve) => (releaseFirst = resolve)))
      getImageDataMock.mockImplementation((_x: number, _y: number, w: number, h: number) =>
        solidImageData(w, h, w === 10 ? [255, 0, 0] : [0, 255, 0])
      )

      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
      const root = container.firstElementChild as HTMLElement

      // Relock to 6×6 while the first downsample is still gated.
      size = { width: 240, height: 240 }
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })

      const tintOfFirstCell = () =>
        (((root.firstElementChild as HTMLElement).children[0] as HTMLElement).children[1] as HTMLElement | undefined)
          ?.style.backgroundColor

      // The 6×6 pass wins: a green tint lands on the relocked grid.
      await waitFor(() => {
        expect((root.firstElementChild as HTMLElement).children).toHaveLength(6 * 6)
        expect(tintOfFirstCell()).toBe('rgb(0, 255, 0)')
      })

      // Releasing the stale 10×10 pass must NOT overwrite the current colours — the
      // `active` guard drops its result because a newer geometry superseded it.
      await act(async () => {
        releaseFirst(new Blob())
        await Promise.resolve()
      })
      expect(tintOfFirstCell()).toBe('rgb(0, 255, 0)')
    })
  })

  describe('reveal handoff resilience', () => {
    it('still schedules the reveal handoff when the image fails to downsample', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()
      // The image can't be read, so no tint is shown — but the reveal must still
      // complete instead of pinning the skeleton over the finished image forever.
      mockGetImageBlobFromSource.mockRejectedValue(new Error('unreadable'))
      render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />)

      await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(true))

      const call = setTimeoutSpy.mock.calls.find(([fn]) => fn === onRevealReady)!
      expect(call[1]).toBeCloseTo(2300, 0)
      setTimeoutSpy.mockRestore()
    })
  })

  describe('prefers-reduced-motion', () => {
    it('renders a static snapshot with no looping animation', () => {
      reduceMotionState.value = true

      const { container } = render(<PaintingSkeletonGrid />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement
      const cell = grid.children[0] as HTMLElement

      // A plain div (not the animated motion.div), so no looping opacity keyframes.
      expect(cell.dataset.animate).toBeUndefined()
      expect(cell.style.opacity).toBe('0.66')
    })

    it('applies the downsampled tint colour statically when the image is present', async () => {
      reduceMotionState.value = true

      const { container } = render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" />)
      const grid = container.firstElementChild!.firstElementChild as HTMLElement

      // Still a plain div (no animation), but filled with the downsampled colour at
      // the solid tint opacity rather than the grey baseline. The downsample is
      // async, so the colour arrives after the initial static render.
      await waitFor(() => {
        const cell = grid.children[0] as HTMLElement
        expect(cell.style.backgroundColor).toBe(TINT_COLOR)
      })
      const cell = grid.children[0] as HTMLElement
      expect(cell.dataset.animate).toBeUndefined()
      expect(cell.style.opacity).toBe('0.95')
    })

    it('hands off immediately without scheduling a reveal-delay timer', async () => {
      reduceMotionState.value = true
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const onRevealReady = vi.fn()

      render(<PaintingSkeletonGrid imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />)

      await waitFor(() => expect(onRevealReady).toHaveBeenCalledTimes(1))
      // Reduced motion skips the animation window — no delayed handoff timer.
      expect(setTimeoutSpy.mock.calls.some(([fn]) => fn === onRevealReady)).toBe(false)
      setTimeoutSpy.mockRestore()
    })
  })
})
