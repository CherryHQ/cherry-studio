import { render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockPaintingSkeletonGrid = vi.hoisted(() => vi.fn())
vi.mock('../PaintingSkeletonGrid', () => ({
  default: (props: { imageUrl?: string; onRevealReady?: () => void }) => {
    mockPaintingSkeletonGrid(props)
    return <div data-testid="painting-skeleton-grid" />
  }
}))

const mockUseImageGenerationSupport = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: mockUseImageGenerationSupport
}))

// Imported after mocks are registered. The size resolvers are unit-tested in
// form/__tests__/paintingSize.test.ts; here the component reads them through
// usePaintingSizeInfo, driven by the mocked useImageGenerationSupport above.
const { default: PaintingImageSkeleton } = await import('../PaintingImageSkeleton')

/** Minimal registry support declaring a single size-bearing field. */
const supportWith = (key: string, options: string[], def: string) => ({
  modes: { generate: { supports: { [key]: { type: 'enum', options, default: def } } } }
})

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-image-1',
    mode: 'generate',
    prompt: '',
    files: [],
    ...overrides
  }) as PaintingData

describe('PaintingImageSkeleton', () => {
  beforeAll(() => {
    // jsdom lacks ResizeObserver; the skeleton wrapper observes its container.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  beforeEach(() => {
    mockUseImageGenerationSupport.mockReset()
    mockPaintingSkeletonGrid.mockClear()
  })

  it('renders the skeleton grid with the status role', () => {
    mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))

    const { getByRole } = render(<PaintingImageSkeleton painting={makePainting()} />)

    expect(getByRole('status')).toBeInTheDocument()
    expect(getByRole('status').firstElementChild).not.toBeNull()
  })

  it('passes the image url and reveal handoff through to the skeleton grid', () => {
    mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))
    const onRevealReady = vi.fn()

    render(
      <PaintingImageSkeleton
        imageUrl="file:///tmp/image-1.png"
        onRevealReady={onRevealReady}
        painting={makePainting()}
      />
    )

    expect(mockPaintingSkeletonGrid).toHaveBeenLastCalledWith(
      expect.objectContaining({
        imageUrl: 'file:///tmp/image-1.png',
        onRevealReady
      })
    )
  })

  it('fills the area when the model declares no size field', () => {
    mockUseImageGenerationSupport.mockReturnValue(undefined)

    const { getByRole } = render(<PaintingImageSkeleton painting={makePainting()} />)

    // firstElementChild is the [topBar, box] column wrapper; the box itself is its
    // last child (works whether or not a topBar is present).
    const wrapper = getByRole('status').firstElementChild as HTMLElement
    expect(wrapper).toHaveClass('h-full', 'w-full')
    expect(wrapper.lastElementChild).toHaveClass('flex-1', 'min-h-0')
  })

  it('falls back to the declared-ratio box when reveal natural size is unavailable', () => {
    mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))

    const { getByRole } = render(<PaintingImageSkeleton painting={makePainting()} />)

    const box = getByRole('status').firstElementChild!.lastElementChild as HTMLElement
    expect(box.style.aspectRatio).toBe('1')
    expect(box.style.width).not.toMatch(/px$/)
  })

  describe('reveal geometry relock', () => {
    let clientWidth: ReturnType<typeof vi.spyOn>
    let clientHeight: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
      clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    })

    afterEach(() => {
      clientWidth.mockRestore()
      clientHeight.mockRestore()
    })

    it('locks the box to min(natural size, contain fit) once natural dimensions are known', () => {
      mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))

      const { getByRole } = render(
        <PaintingImageSkeleton naturalHeight={500} naturalWidth={1000} painting={makePainting()} />
      )

      // Contain-fit against a 400x300 container: scale = min(1, 400/1000, 300/500) = 0.4.
      const box = getByRole('status').firstElementChild!.lastElementChild as HTMLElement
      expect(box.style.width).toBe('400px')
      expect(box.style.height).toBe('200px')
    })

    it('never upscales past the natural size even when the container is larger', () => {
      mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))

      const { getByRole } = render(
        <PaintingImageSkeleton naturalHeight={100} naturalWidth={100} painting={makePainting()} />
      )

      const box = getByRole('status').firstElementChild!.lastElementChild as HTMLElement
      expect(box.style.width).toBe('100px')
      expect(box.style.height).toBe('100px')
    })

    it('reserves the top bar height instead of using the full container', () => {
      mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))
      clientHeight.mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'painting-skeleton-top-bar-measure' ? 60 : 300
      })

      const { getByRole } = render(
        <PaintingImageSkeleton
          naturalHeight={600}
          naturalWidth={200}
          painting={makePainting()}
          topBar={<div>prompt</div>}
        />
      )

      // Reserving the top bar's 60px, contain-fit runs against a 400x(300-60)
      // container: scale = min(1, 400/200, 240/600) = 0.4, so 200x600 → 80x240.
      // (Ignoring the bar would instead contain-fit 200x600 into 400x300 →
      // scale 300/600 = 0.5 → 100x300, clipping the bar.)
      const box = getByRole('status').firstElementChild!.lastElementChild as HTMLElement
      expect(box.style.width).toBe('80px')
      expect(box.style.height).toBe('240px')
    })
  })

  describe('prompt bar alignment', () => {
    let clientWidth: ReturnType<typeof vi.spyOn>
    let clientHeight: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
      clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        return this.dataset.testid === 'painting-skeleton-top-bar-measure' ? 40 : 300
      })
    })

    afterEach(() => {
      clientWidth.mockRestore()
      clientHeight.mockRestore()
    })

    it('pins the [topBar, box] column to the box width so a long prompt cannot stretch it past a narrow image', () => {
      // Portrait 768×1024 (ratio 0.75) in a 400×(300−40 bar) container is
      // height-constrained: box width = availableHeight(260) × 0.75 = 195. The
      // column must be that 195px — the image width — not the 400px canvas nor
      // the long prompt's intrinsic width. (Without the fix the column is only
      // `max-w-full`, so the prompt's intrinsic width stretches it out.)
      mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['768x1024'], '768x1024'))

      const { getByRole } = render(
        <PaintingImageSkeleton painting={makePainting()} topBar={<div>{'a very long prompt '.repeat(50)}</div>} />
      )

      const column = getByRole('status').firstElementChild as HTMLElement
      expect(column.style.width).toBe('195px')
      // The box carries the same width, so the bar (stretched to the column) aligns with it.
      expect((column.lastElementChild as HTMLElement).style.width).toBe('195px')
      // The bar wrapper keeps `min-w-0` so its content truncates rather than
      // forcing the column wider (jsdom can't render the stretch, so pin the guard).
      expect(column.firstElementChild).toHaveClass('min-w-0')
    })

    it('tracks the full canvas width for an image wider than the container (width-constrained)', () => {
      // Wide 1600×800 (ratio 2.0) exceeds the container's 400/260≈1.54 aspect, so
      // it's width-constrained: box = 400 × (400/2 = 200). The column spans the
      // full 400px canvas, and box height comes from `container.width / ratio` —
      // pinning that formula, which the portrait branch above never exercises.
      mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1600x800'], '1600x800'))

      const { getByRole } = render(<PaintingImageSkeleton painting={makePainting()} topBar={<div>prompt</div>} />)

      const column = getByRole('status').firstElementChild as HTMLElement
      expect(column.style.width).toBe('400px')
      const box = column.lastElementChild as HTMLElement
      expect(box.style.width).toBe('400px')
      expect(box.style.height).toBe('200px')
    })
  })
})
