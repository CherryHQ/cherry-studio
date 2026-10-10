import { act, fireEvent, render, waitFor } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PaintingSkeletonSurface from '../PaintingSkeletonSurface'

type MotionDivProps = {
  children?: ReactNode
  animate?: unknown
  initial?: unknown
  onAnimationComplete?: () => void
  style?: CSSProperties
  transition?: unknown
  [key: string]: unknown
}

const reduceMotionState = vi.hoisted(() => ({ value: false }))
vi.mock('motion/react', () => {
  const MotionDiv = ({ children, animate, initial, onAnimationComplete, transition, ...props }: MotionDivProps) => (
    <div
      {...props}
      data-animate={JSON.stringify(animate)}
      data-initial={JSON.stringify(initial)}
      data-transition={JSON.stringify(transition)}
      onAnimationEnd={onAnimationComplete}>
      {children}
    </div>
  )
  const MotionImg = ({ animate, initial, onAnimationComplete, transition, ...props }: MotionDivProps) => (
    <img
      {...props}
      data-animate={JSON.stringify(animate)}
      data-initial={JSON.stringify(initial)}
      data-transition={JSON.stringify(transition)}
      onAnimationEnd={onAnimationComplete}
    />
  )

  return {
    motion: { div: MotionDiv, img: MotionImg },
    useReducedMotion: () => reduceMotionState.value
  }
})

const mockGetImageBlobFromSource = vi.hoisted(() => vi.fn())
vi.mock('@renderer/utils/image', () => ({
  getImageBlobFromSource: mockGetImageBlobFromSource
}))

const mockLoggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: mockLoggerWarn })
  }
}))

const solidImageData = (width: number, height: number, [red, green, blue]: [number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = red
    data[index * 4 + 1] = green
    data[index * 4 + 2] = blue
    data[index * 4 + 3] = 255
  }
  return { data }
}

const getSlot = (container: HTMLElement, slot: string) => container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)

describe('PaintingSkeletonSurface', () => {
  let size = { width: 280, height: 280 }
  let resizeCallback: ResizeObserverCallback | undefined
  let drawImageMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>
  let getImageDataMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>

  beforeEach(() => {
    reduceMotionState.value = false
    size = { width: 280, height: 280 }
    resizeCallback = undefined
    mockLoggerWarn.mockReset()
    mockGetImageBlobFromSource.mockReset().mockResolvedValue(new Blob())

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, size.width, size.height)
    )

    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }))
    drawImageMock = vi.fn()
    getImageDataMock = vi.fn((_x: number, _y: number, width: number, height: number) =>
      solidImageData(width, height, [10, 20, 30])
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: drawImageMock,
      getImageData: getImageDataMock
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the referenced dense rounded-square blink grid while waiting for the image', () => {
    const { container } = render(<PaintingSkeletonSurface />)
    const surface = getSlot(container, 'painting-skeleton-surface')!
    const grid = getSlot(container, 'painting-skeleton-grid')!
    const cells = grid.querySelectorAll<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')

    expect(surface).toHaveClass('bg-background')
    expect(cells).toHaveLength(12 * 12)
    expect(cells[0].dataset.phase).toBe('loading')
    expect(cells[0].style.width).toBe('14px')
    expect(cells[0].style.height).toBe('14px')
    expect(cells[0].style.borderRadius).toBe('3px')
    expect(cells[0].style.backgroundColor).toBe('var(--muted-foreground)')
    expect(cells[0].style.animationName).toBe('painting-skeleton-cell-blink')
    expect(cells[0].style.animationDuration).toBe('2000ms')
    expect(cells[0].style.animationDelay).not.toBe(cells[1].style.animationDelay)
    expect(getSlot(container, 'painting-skeleton-reveal')).toBeNull()
  })

  it('remeasures the dense grid without inflating the cell size', () => {
    const { container } = render(<PaintingSkeletonSurface />)
    const initialGrid = getSlot(container, 'painting-skeleton-grid')!
    const initialCell = initialGrid.querySelector('[data-slot="painting-skeleton-grid-cell"]')

    size = { width: 56, height: 56 }
    act(() => resizeCallback?.([], {} as ResizeObserver))

    const resizedGrid = getSlot(container, 'painting-skeleton-grid')!
    const resizedCells = resizedGrid.querySelectorAll<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')
    expect(resizedCells).toHaveLength(4 * 4)
    expect(resizedCells[0]).not.toBe(initialCell)
    expect(resizedCells[0].style.width).toBe('14px')
  })

  it('samples image colors, fills the grid gaps, and gradually fades in the image', async () => {
    const { container } = render(<PaintingSkeletonSurface imageUrl="file:///tmp/real.png" />)

    await waitFor(() => {
      const firstCell = container.querySelector<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')!
      expect(firstCell.dataset.phase).toBe('coloring')
    })

    const firstCell = container.querySelector<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')!
    const reveal = getSlot(container, 'painting-skeleton-reveal')!

    expect(drawImageMock).toHaveBeenCalledWith(expect.anything(), 0, 0, 12, 12)
    expect(getImageDataMock).toHaveBeenCalledWith(0, 0, 12, 12)
    expect(firstCell.style.backgroundColor).toBe('rgb(10, 20, 30)')
    expect(firstCell.style.width).toBe('28px')
    expect(firstCell.style.height).toBe('28px')
    expect(firstCell.style.animationName).toBe('none')
    expect(reveal).toHaveAttribute('src', 'file:///tmp/real.png')
    expect(reveal).toHaveClass('object-cover')
    expect(JSON.parse(reveal.dataset.initial!)).toEqual({ opacity: 0 })
    expect(JSON.parse(reveal.dataset.animate!)).toEqual({ opacity: 1 })
    expect(JSON.parse(reveal.dataset.transition!)).toEqual({
      delay: 0.5,
      duration: 0.9,
      ease: 'easeOut'
    })
    expect(getSlot(container, 'painting-skeleton-particle-frontier')).toBeNull()
  })

  it('fades the colored cells with staggered delays after they fill the gaps', async () => {
    vi.useFakeTimers()
    const { container } = render(<PaintingSkeletonSurface imageUrl="file:///tmp/real.png" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    const cells = container.querySelectorAll<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')
    expect(cells[0].dataset.phase).toBe('fading')
    expect(cells[0].style.opacity).toBe('0')
    expect(cells[0].style.transition).toContain('opacity 600ms')
    expect(cells[0].style.transitionDelay).not.toBe(cells[1].style.transitionDelay)
  })

  it('hands off only once after the image fade has completed', async () => {
    const onRevealReady = vi.fn()
    const { container } = render(
      <PaintingSkeletonSurface imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />
    )

    await waitFor(() => expect(getSlot(container, 'painting-skeleton-reveal')).not.toBeNull())
    const reveal = getSlot(container, 'painting-skeleton-reveal')!
    fireEvent.animationEnd(reveal)
    fireEvent.animationEnd(reveal)

    expect(onRevealReady).toHaveBeenCalledTimes(1)
  })

  it('still reveals the image when its colors cannot be sampled', async () => {
    mockGetImageBlobFromSource.mockRejectedValue(new Error('unreadable'))
    const { container } = render(<PaintingSkeletonSurface imageUrl="file:///tmp/real.png" />)

    await waitFor(() => expect(getSlot(container, 'painting-skeleton-reveal')).not.toBeNull())

    const firstCell = container.querySelector<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')!
    expect(firstCell.style.backgroundColor).toBe('var(--muted-foreground)')
    expect(mockLoggerWarn).toHaveBeenCalledOnce()
  })

  it('does not hand off while there is no decoded image', () => {
    const onRevealReady = vi.fn()
    const { container } = render(<PaintingSkeletonSurface onRevealReady={onRevealReady} />)

    expect(getSlot(container, 'painting-skeleton-reveal')).toBeNull()
    expect(onRevealReady).not.toHaveBeenCalled()
  })

  it('uses a static grid and immediately hands off the full image when reduced motion is preferred', async () => {
    reduceMotionState.value = true
    const onRevealReady = vi.fn()
    const waiting = render(<PaintingSkeletonSurface onRevealReady={onRevealReady} />)
    const waitingCell = waiting.container.querySelector<HTMLElement>('[data-slot="painting-skeleton-grid-cell"]')!

    expect(waitingCell.dataset.phase).toBe('loading')
    expect(waitingCell.style.animationName).toBe('none')
    waiting.unmount()

    const ready = render(<PaintingSkeletonSurface imageUrl="file:///tmp/real.png" onRevealReady={onRevealReady} />)
    const reveal = getSlot(ready.container, 'painting-skeleton-reveal')!

    expect(reveal.dataset.animate).toBeUndefined()
    expect(reveal).toHaveAttribute('src', 'file:///tmp/real.png')
    expect(mockGetImageBlobFromSource).not.toHaveBeenCalled()
    await waitFor(() => expect(onRevealReady).toHaveBeenCalledTimes(1))
  })
})
