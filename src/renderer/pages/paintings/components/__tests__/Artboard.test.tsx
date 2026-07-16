import type { FileMetadata } from '@renderer/types/file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'paintings.generating' ? '绘图进行中，请不要离开页面' : key)
  })
}))

vi.mock('@renderer/utils/image', () => ({
  convertImageToPng: vi.fn()
}))

const mockComputeImageNaturalSize = vi.hoisted(() => vi.fn())
vi.mock('../../utils/computeImageNaturalSize', () => ({
  computeImageNaturalSize: mockComputeImageNaturalSize
}))

// The skeleton owns its own aspect-ratio + registry-support logic (covered by
// PaintingImageSkeleton.test.tsx); here we only assert Artboard swaps to it
// while generating, so a lightweight stand-in keeps this test off the data layer.
const mockSkeletonProps = vi.hoisted(() => vi.fn())
vi.mock('../PaintingImageSkeleton', () => ({
  default: (props: {
    imageUrl?: string
    naturalWidth?: number
    naturalHeight?: number
    onRevealReady?: () => void
    topBar?: React.ReactNode
  }) => {
    mockSkeletonProps(props)
    return (
      <div>
        {props.topBar}
        <button
          type="button"
          data-testid="painting-image-skeleton"
          data-image-url={props.imageUrl ?? ''}
          data-natural-width={props.naturalWidth ?? ''}
          data-natural-height={props.naturalHeight ?? ''}
          onClick={() => props.onRevealReady?.()}
        />
      </div>
    )
  }
}))

// usePaintingSizeInfo (aspect ratio + size label) is unit-tested via
// form/__tests__/paintingSize.test.ts; here it's just the prompt bar's size-text
// source, so a hoisted stub keeps that assertion simple.
const mockUsePaintingSizeInfo = vi.hoisted(() =>
  vi.fn(() => ({ ratio: null as number | null, sizeLabel: undefined as string | undefined }))
)
vi.mock('../../hooks/usePaintingSizeInfo', () => ({
  usePaintingSizeInfo: mockUsePaintingSizeInfo
}))

const { default: Artboard } = await import('../Artboard')

const makeFile = (id: string): FileMetadata =>
  ({
    id,
    name: `${id}.png`,
    origin_name: `${id}.png`,
    path: `/tmp/${id}.png`,
    size: 100,
    ext: '.png',
    type: 'image',
    created_at: '2026-01-01T00:00:00.000Z',
    count: 1
  }) as FileMetadata

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({
    id: 'painting-1',
    providerId: 'openai',
    mode: 'generate',
    prompt: '',
    files: [makeFile('image-1'), makeFile('image-2')],
    ...overrides
  }) as PaintingData

const firePointer = (element: Element, type: string, init: Record<string, number>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })

  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value })
  }

  fireEvent(element, event)
}

describe('Artboard', () => {
  beforeAll(() => {
    HTMLElement.prototype.setPointerCapture ??= vi.fn()
    HTMLElement.prototype.releasePointerCapture ??= vi.fn()
    HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => true)
  })

  beforeEach(() => {
    mockComputeImageNaturalSize.mockReset()
    mockSkeletonProps.mockClear()
    mockUsePaintingSizeInfo.mockReset()
    mockUsePaintingSizeInfo.mockReturnValue({ ratio: null, sizeLabel: undefined })
  })

  it('renders the shimmer skeleton while generating', () => {
    render(<Artboard painting={makePainting()} isLoading={true} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders the generated image and no skeleton when idle', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('enters reveal skeleton before showing a newly generated image', () => {
    mockComputeImageNaturalSize.mockReturnValue(new Promise(() => {}))
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(mockComputeImageNaturalSize).toHaveBeenCalledWith('file:///tmp/image-1.png')
    // Pending: the natural size is still decoding, so the image url (and the whole
    // reveal choreography it drives) is withheld from the skeleton until `ready`.
    expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute('data-image-url', '')
  })

  it('withholds the reveal handoff from the skeleton while the natural size is still pending', () => {
    mockComputeImageNaturalSize.mockReturnValue(new Promise(() => {}))
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    // Pending: neither the image url nor onRevealReady reach the skeleton yet.
    // Offering the handoff now would flash the image, then the resolving natural
    // size would resurrect the skeleton over it (a double reveal).
    const props = mockSkeletonProps.mock.calls.at(-1)?.[0]
    expect(props?.imageUrl).toBeUndefined()
    expect(props?.onRevealReady).toBeUndefined()
  })

  it('keeps the reveal skeleton when loading finishes before the image arrives', async () => {
    mockComputeImageNaturalSize.mockResolvedValue({ naturalWidth: 512, naturalHeight: 512 })
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={painting} isLoading={false} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(mockComputeImageNaturalSize).not.toHaveBeenCalled()

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() =>
      expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute('data-image-url', 'file:///tmp/image-1.png')
    )
    expect(document.querySelector('img')).toBeNull()
  })

  it('clears the reveal skeleton when generation is canceled before any image exists', () => {
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    // A canceled generation never produces a file, so the reveal machine must
    // escape `{ status: 'awaiting' }` on the generationStatus change alone —
    // nothing else changes to escape it, since `files` stays empty after a cancel.
    rerender(<Artboard painting={{ ...painting, generationStatus: 'canceled' }} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('clears the reveal skeleton when generation fails before any image exists', () => {
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={{ ...painting, generationStatus: 'failed' }} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('passes the image url and natural size to the reveal skeleton before showing the image', async () => {
    mockComputeImageNaturalSize.mockResolvedValue({ naturalWidth: 512, naturalHeight: 768 })
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() =>
      expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute('data-image-url', 'file:///tmp/image-1.png')
    )
    const skeleton = screen.getByTestId('painting-image-skeleton')
    expect(skeleton).toHaveAttribute('data-natural-width', '512')
    expect(skeleton).toHaveAttribute('data-natural-height', '768')
    expect(document.querySelector('img')).toBeNull()

    fireEvent.click(screen.getByTestId('painting-image-skeleton'))

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('shows the image immediately when natural size computation returns null', async () => {
    mockComputeImageNaturalSize.mockResolvedValue(null)
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() => expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument())
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('shows the image immediately when natural size computation rejects', async () => {
    mockComputeImageNaturalSize.mockRejectedValue(new Error('decode failed'))
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() => expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument())
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('renders nothing when idle with no images and no cover', () => {
    render(<Artboard painting={makePainting({ files: [] })} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  describe('reveal state isolation across paintings', () => {
    it('does not strand a newly selected file-less painting in a fake generating skeleton', () => {
      mockComputeImageNaturalSize.mockReturnValue(new Promise(() => {}))
      // Painting A is generating (no files yet).
      const { rerender } = render(<Artboard painting={makePainting({ id: 'A', files: [] })} isLoading={true} />)
      expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()

      // Selecting a different, file-less painting B (which is not generating) must
      // not leak A's loading state and pin B in a permanent "awaiting" skeleton.
      rerender(<Artboard painting={makePainting({ id: 'B', files: [] })} isLoading={false} />)

      expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
      expect(document.querySelector('img')).toBeNull()
    })

    it('shows an already-generated painting immediately instead of replaying a reveal on switch', () => {
      mockComputeImageNaturalSize.mockReturnValue(new Promise(() => {}))
      const { rerender } = render(<Artboard painting={makePainting({ id: 'A', files: [] })} isLoading={true} />)

      // Switch mid-generation to a different painting that already has files.
      rerender(<Artboard painting={makePainting({ id: 'C' })} isLoading={false} />)

      // The finished image shows at once — no reveal skeleton, no redundant natural-size pass.
      expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
      expect(document.querySelector('img')).not.toBeNull()
      expect(mockComputeImageNaturalSize).not.toHaveBeenCalled()
    })

    it('drops an in-flight reveal when the painting changes mid-reveal', async () => {
      mockComputeImageNaturalSize.mockResolvedValue({ naturalWidth: 512, naturalHeight: 512 })
      const { rerender } = render(<Artboard painting={makePainting({ id: 'A', files: [] })} isLoading={true} />)
      // A finishes generating and enters its reveal (natural size resolves).
      rerender(<Artboard painting={makePainting({ id: 'A' })} isLoading={false} />)
      await waitFor(() =>
        expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute(
          'data-image-url',
          'file:///tmp/image-1.png'
        )
      )

      // Switching to a different, already-generated painting cancels A's reveal.
      rerender(<Artboard painting={makePainting({ id: 'C' })} isLoading={false} />)

      expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
      expect(document.querySelector('img')).not.toBeNull()
    })

    it('shows a plain generating skeleton (no stale reveal) while an already-revealed painting regenerates', async () => {
      mockComputeImageNaturalSize.mockResolvedValue({ naturalWidth: 512, naturalHeight: 512 })
      const { rerender } = render(<Artboard painting={makePainting({ files: [] })} isLoading={true} />)
      rerender(<Artboard painting={makePainting()} isLoading={false} />)
      await waitFor(() =>
        expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute(
          'data-image-url',
          'file:///tmp/image-1.png'
        )
      )

      // Regenerating the same painting drops back to a plain generating skeleton —
      // the previous run's reveal payload never bleeds through while loading.
      rerender(<Artboard painting={makePainting()} isLoading={true} />)

      expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute('data-image-url', '')
    })
  })

  describe('prompt bar', () => {
    // The Tooltip mock renders both the trigger and a `tooltip-content` echo of the
    // same text, so assertions target the visible `.truncate` preview specifically.
    const previewText = () => document.querySelector('.truncate')?.textContent

    it('renders a short prompt in full', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={true} />)

      expect(previewText()).toBe('a red cat')
    })

    it('keeps the full prompt in the DOM for long prompts, truncating via CSS not JS', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat wearing a tiny hat' })} isLoading={true} />)

      const preview = document.querySelector('.truncate') as HTMLElement
      // The full prompt stays in the DOM (and tooltip); the `.truncate` class clips
      // it to the available width via CSS rather than a fixed-length JS slice.
      expect(preview.textContent).toBe('a red cat wearing a tiny hat')
      expect(preview).toHaveClass('truncate')
    })

    it('shows the resolved size label alongside the prompt', () => {
      mockUsePaintingSizeInfo.mockReturnValue({ ratio: null, sizeLabel: '1024×1024' })

      render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={true} />)

      expect(screen.getByText('1024×1024')).toBeInTheDocument()
    })

    it('shows above the generated image once idle, not just while generating', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)

      expect(previewText()).toBe('a red cat')
      expect(document.querySelector('img')).not.toBeNull()
    })

    it('does not render when there is no prompt', () => {
      const { container } = render(<Artboard painting={makePainting({ prompt: '' })} isLoading={true} />)

      expect(container.querySelector('.text-muted-foreground.text-xs')).toBeNull()
    })

    it('does not render when idle with no images and no cover', () => {
      const { container } = render(
        <Artboard painting={makePainting({ files: [], prompt: 'a red cat' })} isLoading={false} />
      )

      expect(container.querySelector('.text-muted-foreground.text-xs')).toBeNull()
    })

    describe('once the image loads', () => {
      let clientWidth: ReturnType<typeof vi.spyOn>
      let clientHeight: ReturnType<typeof vi.spyOn>
      let naturalWidth: ReturnType<typeof vi.spyOn>
      let naturalHeight: ReturnType<typeof vi.spyOn>

      beforeEach(() => {
        // Container is wide (800x400) relative to a square 1024x1024 photo. The prompt
        // bar's own measured height (24) comes out of the 400 first, so the binding
        // constraint is (400-24)/1024: contain-fit is 376x376.
        clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
        clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
          this: HTMLElement
        ) {
          return this.dataset.testid === 'artboard-prompt-bar-measure' ? 24 : 400
        })
        naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1024)
        naturalHeight = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1024)
      })

      afterEach(() => {
        clientWidth.mockRestore()
        clientHeight.mockRestore()
        naturalWidth.mockRestore()
        naturalHeight.mockRestore()
      })

      it('locks the bar+image wrapper to the contain-fit width instead of the full container', () => {
        render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)

        fireEvent.load(document.querySelector('img') as HTMLImageElement)

        expect(screen.getByTestId('artboard-image-transform').style.width).toBe('376px')
      })

      it('re-measures when switching to a differently sized generated image', () => {
        render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)

        fireEvent.load(document.querySelector('img') as HTMLImageElement)
        expect(screen.getByTestId('artboard-image-transform').style.width).toBe('376px')

        fireEvent.click(screen.getByRole('button', { name: 'preview.next' }))

        // The new image hasn't reported its natural size yet — falls back to filling
        // the container instead of carrying over the previous image's locked width.
        expect(screen.getByTestId('artboard-image-transform').style.width).toBe('')
      })

      it('measures the wrapper even when Artboard first mounted while still loading', async () => {
        mockComputeImageNaturalSize.mockResolvedValue(null)
        const painting = makePainting({ prompt: 'a red cat', files: [] })
        const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

        // The real-image wrapper (and its ref) doesn't exist in the DOM yet at this
        // first mount — only the skeleton branch does. A plain ref + mount-only
        // effect would attach nothing here and never get another chance to.
        rerender(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)
        await waitFor(() => expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument())

        fireEvent.load(document.querySelector('img') as HTMLImageElement)

        expect(screen.getByTestId('artboard-image-transform').style.width).toBe('376px')
      })

      it('reserves the prompt bar height instead of using the full container', () => {
        render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)

        fireEvent.load(document.querySelector('img') as HTMLImageElement)

        const image = document.querySelector('img') as HTMLImageElement
        // Contain-fit reserves the prompt bar's 24px first: (400-24)/1024 is the
        // binding scale → 376px, not the 400px an unreserved container would give
        // (which would clip the bar).
        expect(image.style.height).toBe('376px')
      })
    })
  })

  it('resets image transform when switching generated images', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    const image = document.querySelector('img') as HTMLImageElement
    // The transform lives on the image's flex-col wrapper (which also holds the
    // prompt bar) so the bar pans/zooms/rotates together with the artwork.
    const transformTarget = screen.getByTestId('artboard-image-transform')

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.rotate_right' }))
    firePointer(image, 'pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    firePointer(image, 'pointermove', { clientX: 35, clientY: 45, pointerId: 1 })

    expect(transformTarget.style.transform).toBe('translate(25px, 35px) scale(1.25) rotate(90deg)')

    fireEvent.click(screen.getByRole('button', { name: 'preview.next' }))

    expect(image).toHaveAttribute('src', 'file:///tmp/image-2.png')
    expect(transformTarget.style.transform).toBe('translate(0px, 0px) scale(1) rotate(0deg)')
  })

  it('shows copy and download actions from the generated image context menu', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    const image = document.querySelector('img') as HTMLImageElement

    fireEvent.contextMenu(image)

    expect(screen.getByRole('button', { name: 'common.copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'preview.copy.src' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.download' })).toBeInTheDocument()
  })

  it('ignores non-left-button image drag attempts', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    const image = document.querySelector('img') as HTMLImageElement
    const transformTarget = screen.getByTestId('artboard-image-transform')

    firePointer(image, 'pointerdown', { button: 1, clientX: 10, clientY: 10, pointerId: 1 })
    firePointer(image, 'pointermove', { clientX: 35, clientY: 45, pointerId: 1 })

    expect(transformTarget.style.transform).toBe('translate(0px, 0px) scale(1) rotate(0deg)')
  })

  it('disables zoom controls at image scale boundaries', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    const transformTarget = screen.getByTestId('artboard-image-transform')
    const zoomInButton = screen.getByRole('button', { name: 'preview.zoom_in' })
    const zoomOutButton = screen.getByRole('button', { name: 'preview.zoom_out' })

    expect(zoomOutButton).not.toBeDisabled()

    for (let i = 0; i < 3; i++) {
      fireEvent.click(zoomOutButton)
    }

    expect(transformTarget.style.transform).toBe('translate(0px, 0px) scale(0.25) rotate(0deg)')
    expect(zoomInButton).not.toBeDisabled()
    expect(zoomOutButton).toBeDisabled()

    for (let i = 0; i < 15; i++) {
      fireEvent.click(zoomInButton)
    }

    expect(transformTarget.style.transform).toBe('translate(0px, 0px) scale(4) rotate(0deg)')
    expect(zoomInButton).toBeDisabled()
    expect(zoomOutButton).not.toBeDisabled()
  })
})
