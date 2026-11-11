import { render } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockPaintingSkeletonSurface = vi.hoisted(() => vi.fn())
vi.mock('../PaintingSkeletonSurface', () => ({
  default: (props: { imageUrl?: string; onRevealReady?: () => void }) => {
    mockPaintingSkeletonSurface(props)
    return <div data-testid="painting-skeleton-surface" />
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

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData => ({
  id: 'p1',
  providerId: 'openai',
  model: 'gpt-image-1',
  mode: 'generate',
  prompt: '',
  files: [],
  ...overrides
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
  })

  beforeEach(() => {
    mockUseImageGenerationSupport.mockReset()
    mockPaintingSkeletonSurface.mockClear()
  })

  it('renders the skeleton surface with the status role', () => {
    mockUseImageGenerationSupport.mockReturnValue(supportWith('size', ['1024x1024'], '1024x1024'))

    const { getByRole } = render(<PaintingImageSkeleton painting={makePainting()} />)

    expect(getByRole('status')).toBeInTheDocument()
    expect(getByRole('status').firstElementChild).not.toBeNull()
  })
})
