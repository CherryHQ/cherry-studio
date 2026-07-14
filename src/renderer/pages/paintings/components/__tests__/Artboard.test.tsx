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

const mockComputeImageBlurhash = vi.hoisted(() => vi.fn())
vi.mock('../../utils/computeImageBlurhash', () => ({
  computeImageBlurhash: mockComputeImageBlurhash
}))

// The skeleton owns its own aspect-ratio + registry-support logic (covered by
// PaintingImageSkeleton.test.tsx); here we only assert Artboard swaps to it
// while generating, so a lightweight stand-in keeps this test off the data layer.
const mockSkeletonProps = vi.hoisted(() => vi.fn())
// resolveSizeLabel is covered on its own in PaintingImageSkeleton.test.tsx; here it's
// just the prompt bar's size-text source, so a hoisted stub keeps that assertion simple.
const mockResolveSizeLabel = vi.hoisted(() => vi.fn(() => undefined as string | undefined))
vi.mock('../PaintingImageSkeleton', () => ({
  default: (props: {
    blurhash?: string
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
          data-blurhash={props.blurhash ?? ''}
          data-image-url={props.imageUrl ?? ''}
          data-natural-width={props.naturalWidth ?? ''}
          data-natural-height={props.naturalHeight ?? ''}
          onClick={() => props.onRevealReady?.()}
        />
      </div>
    )
  },
  resolveSizeLabel: mockResolveSizeLabel
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
    mockComputeImageBlurhash.mockReset()
    mockSkeletonProps.mockClear()
    mockResolveSizeLabel.mockReset()
    mockResolveSizeLabel.mockReturnValue(undefined)
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
    mockComputeImageBlurhash.mockReturnValue(new Promise(() => {}))
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(mockComputeImageBlurhash).toHaveBeenCalledWith('file:///tmp/image-1.png')
    // The real image URL is already known before blurhash resolves — it's what
    // computeImageBlurhash decodes from, so it never lags behind the blurhash.
    expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute('data-image-url', 'file:///tmp/image-1.png')
  })

  it('keeps the reveal skeleton when loading finishes before the image arrives', async () => {
    mockComputeImageBlurhash.mockResolvedValue({
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      naturalWidth: 512,
      naturalHeight: 512
    })
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={painting} isLoading={false} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(mockComputeImageBlurhash).not.toHaveBeenCalled()

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() =>
      expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute(
        'data-blurhash',
        'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
      )
    )
    expect(document.querySelector('img')).toBeNull()
  })

  it('clears the reveal skeleton when generation is canceled before any image exists', () => {
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    // Without the fix this stays stuck at `{ status: 'awaiting' }` forever — nothing
    // else changes to escape it, since `files` stays empty after a cancel.
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

  it('passes the computed blurhash, image url and natural size to the reveal skeleton before showing the image', async () => {
    mockComputeImageBlurhash.mockResolvedValue({
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      naturalWidth: 512,
      naturalHeight: 768
    })
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() =>
      expect(screen.getByTestId('painting-image-skeleton')).toHaveAttribute(
        'data-blurhash',
        'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
      )
    )
    const skeleton = screen.getByTestId('painting-image-skeleton')
    expect(skeleton).toHaveAttribute('data-image-url', 'file:///tmp/image-1.png')
    expect(skeleton).toHaveAttribute('data-natural-width', '512')
    expect(skeleton).toHaveAttribute('data-natural-height', '768')
    expect(document.querySelector('img')).toBeNull()

    fireEvent.click(screen.getByTestId('painting-image-skeleton'))

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('shows the image immediately when blurhash computation returns null', async () => {
    mockComputeImageBlurhash.mockResolvedValue(null)
    const painting = makePainting({ files: [] })
    const { rerender } = render(<Artboard painting={painting} isLoading={true} />)

    rerender(<Artboard painting={makePainting()} isLoading={false} />)

    await waitFor(() => expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument())
    expect(document.querySelector('img')).not.toBeNull()
  })

  it('shows the image immediately when blurhash computation rejects', async () => {
    mockComputeImageBlurhash.mockRejectedValue(new Error('decode failed'))
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

  describe('prompt bar', () => {
    // The Tooltip mock renders both the trigger and a `tooltip-content` echo of the
    // same text, so assertions target the visible `.truncate` preview specifically.
    const previewText = () => document.querySelector('.truncate')?.textContent

    it('shows the prompt in full when it is 10 characters or shorter', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={true} />)

      expect(previewText()).toBe('a red cat')
    })

    it('truncates prompts longer than 10 characters with an ellipsis', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat wearing a tiny hat' })} isLoading={true} />)

      expect(previewText()).toBe('a red cat …')
    })

    it('shows the resolved size label alongside the prompt', () => {
      mockResolveSizeLabel.mockReturnValue('1024×1024')

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
        mockComputeImageBlurhash.mockResolvedValue(null)
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
        // Without the fix this would be 400px (400/1024 scale) — clipping the prompt
        // bar's 24px against the container instead of reserving space for it.
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
