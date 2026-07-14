import { render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { imageGenerationToFields } from '../../form/imageGenerationToFields'
import type { PaintingData } from '../../model/types/paintingData'
import { tabToImageGenerationMode } from '../../utils/paintingProviderMode'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockPaintingSkeletonGrid = vi.hoisted(() => vi.fn())
vi.mock('../PaintingSkeletonGrid', () => ({
  default: (props: { blurhash?: string; imageUrl?: string; onRevealReady?: () => void }) => {
    mockPaintingSkeletonGrid(props)
    return <div data-testid="painting-skeleton-grid" />
  }
}))

const mockUseImageGenerationSupport = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useImageGenerationSupport', () => ({
  useImageGenerationSupport: mockUseImageGenerationSupport
}))

// Imported after mocks are registered.
const { default: PaintingImageSkeleton, resolveRatio, resolveSizeLabel } = await import('../PaintingImageSkeleton')

/** Minimal registry support declaring a single size-bearing field. */
const supportWith = (key: string, options: string[], def: string) => ({
  modes: { generate: { supports: { [key]: { type: 'enum', options, default: def } } } }
})

// The same config items the component derives internally, so resolveRatio sees
// the fields (including registry defaults) it would at runtime.
const fieldsFor = (support: unknown) =>
  imageGenerationToFields(support as never, { mode: tabToImageGenerationMode('generate') })

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

describe('resolveRatio', () => {
  it('derives the aspect ratio from a stored size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveRatio({ size: '1024x768' }, fields)).toBe(1024 / 768)
  })

  it('derives the aspect ratio from an aspect-ratio enum', () => {
    const fields = fieldsFor(supportWith('aspectRatio', ['ASPECT_16_9'], 'ASPECT_16_9'))
    expect(resolveRatio({}, fields)).toBe(16 / 9)
  })

  // The effective size is the registry default, not stored in params, so reading
  // params alone would return null; resolveRatio must fall back to initialValue.
  it('falls back to the registry default when nothing is stored', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveRatio({}, fields)).toBe(1)
  })

  it('reads explicit custom dimensions', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveRatio({ size: 'custom', customSize_width: 800, customSize_height: 600 }, fields)).toBe(800 / 600)
  })

  it('uses a 1:1 square when the effective size is auto', () => {
    const fields = fieldsFor(supportWith('size', ['auto', '1024x1024'], 'auto'))
    expect(resolveRatio({ size: 'auto' }, fields)).toBe(1)
  })

  it('returns null when the model declares no size field', () => {
    expect(resolveRatio({}, fieldsFor(undefined))).toBeNull()
  })
})

describe('resolveSizeLabel', () => {
  it('formats a stored pixel size', () => {
    const fields = fieldsFor(supportWith('size', ['1024x768', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: '1024x768' }, fields)).toBe('1024×768')
  })

  it('keeps auto as a label instead of collapsing it to a ratio', () => {
    const fields = fieldsFor(supportWith('size', ['auto', '1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'auto' }, fields)).toBe('auto')
  })

  it('falls back to the registry default when nothing is stored', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024'], '1024x1024'))
    expect(resolveSizeLabel({}, fields)).toBe('1024×1024')
  })

  it('reads explicit custom dimensions', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom', customSize_width: 800, customSize_height: 600 }, fields)).toBe('800×600')
  })

  it('returns undefined for a custom size with no explicit dimensions yet', () => {
    const fields = fieldsFor(supportWith('size', ['1024x1024', 'custom'], '1024x1024'))
    expect(resolveSizeLabel({ size: 'custom' }, fields)).toBeUndefined()
  })

  it('returns undefined when the model declares no size field', () => {
    expect(resolveSizeLabel({}, fieldsFor(undefined))).toBeUndefined()
  })
})

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
    // jsdom lacks matchMedia; motion's useReducedMotion reads it.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false
    }))
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

  it('passes blurhash and image url reveal props through to the skeleton grid', () => {
    mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))
    const onRevealReady = vi.fn()

    render(
      <PaintingImageSkeleton
        blurhash="LEHV6nWB2yk8pyo0adR*.7kCMdnj"
        imageUrl="file:///tmp/image-1.png"
        onRevealReady={onRevealReady}
        painting={makePainting()}
      />
    )

    expect(mockPaintingSkeletonGrid).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
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

      // Without the fix this would be 200x300 (300/600 scale) — clipping the top bar's
      // 60px against the container instead of reserving space for it. With it, contain-fit
      // runs against a 400x(300-60) container: scale = min(1, 400/200, 240/600) = 0.4.
      const box = getByRole('status').firstElementChild!.lastElementChild as HTMLElement
      expect(box.style.width).toBe('80px')
      expect(box.style.height).toBe('240px')
    })
  })
})
