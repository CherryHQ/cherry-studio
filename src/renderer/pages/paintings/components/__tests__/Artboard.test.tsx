import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImgHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUI from '@cherrystudio/ui'
import type { FileMetadata } from '@renderer/types/file'

import type { PaintingData } from '../../model/types/paintingData'

vi.mock('@cherrystudio/ui', async () => {
  const actual = await vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui')
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => children
  }
})

vi.mock('@renderer/components/ImageViewer', async () => {
  const React = await import('react')

  return {
    default: function MockImageViewer({
      preview: _preview,
      onContextMenu,
      ...props
    }: ImgHTMLAttributes<HTMLImageElement> & { preview?: unknown }) {
      const [showContextActions, setShowContextActions] = React.useState(false)
      void _preview

      return (
        <>
          <img
            {...props}
            onContextMenu={(event) => {
              onContextMenu?.(event)
              setShowContextActions(true)
            }}
          />
          {showContextActions && (
            <>
              <button type="button">common.copy</button>
              <button type="button">preview.copy.src</button>
              <button type="button">common.download</button>
            </>
          )}
        </>
      )
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'paintings.generating' ? '绘图进行中，请不要离开页面' : key)
  })
}))

vi.mock('@renderer/utils/image', () => ({
  convertImageToPng: vi.fn()
}))

const mockComputeImageNaturalSize = vi.hoisted(() => vi.fn())
const mockWriteText = vi.hoisted(() => vi.fn())
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

const makeFile = (id: string): FileMetadata => ({
  id,
  name: `${id}.png`,
  origin_name: `${id}.png`,
  path: `/tmp/${id}.png`,
  size: 100,
  ext: '.png',
  type: 'image',
  created_at: '2026-01-01T00:00:00.000Z',
  count: 1
})

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData => ({
  id: 'painting-1',
  providerId: 'openai',
  mode: 'generate',
  prompt: '',
  files: [makeFile('image-1'), makeFile('image-2')],
  ...overrides
})

const firePointer = (element: Element, type: string, init: Record<string, number | string>) => {
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
    mockWriteText.mockReset()
    mockWriteText.mockResolvedValue(undefined)
    mockSkeletonProps.mockClear()
    mockUsePaintingSizeInfo.mockReset()
    mockUsePaintingSizeInfo.mockReturnValue({ ratio: null, sizeLabel: undefined })
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } })
  })

  it('renders the shimmer skeleton while generating', () => {
    render(<Artboard painting={makePainting()} isLoading={true} />)

    expect(screen.getByTestId('painting-image-skeleton')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByRole('img', { name: 'paintings.image_placeholder' })).not.toBeInTheDocument()
  })

  it('renders the generated image and no skeleton when idle', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeNull()
    expect(screen.queryByRole('img', { name: 'paintings.image_placeholder' })).not.toBeInTheDocument()
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
    // reveal transition it drives) is withheld from the skeleton until `ready`.
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

  it('renders a blank artboard when idle with no images and no cover', () => {
    render(<Artboard painting={makePainting({ files: [] })} isLoading={false} />)

    expect(screen.queryByTestId('painting-image-skeleton')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    const placeholder = screen.getByRole('img', { name: 'paintings.image_placeholder' })
    expect(placeholder).toHaveClass('size-[min(72cqh,96cqw)]')
    expect(placeholder.parentElement).toHaveClass('[container-type:size]')
    expect(placeholder.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders a supplied cover instead of the blank artboard', () => {
    render(
      <Artboard
        painting={makePainting({ files: [] })}
        isLoading={false}
        imageCover={<div data-testid="painting-image-cover" />}
      />
    )

    expect(screen.getByTestId('painting-image-cover')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'paintings.image_placeholder' })).not.toBeInTheDocument()
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
    const previewText = () => document.querySelector('.truncate')?.textContent

    it('renders a short prompt in full', () => {
      render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={true} />)

      expect(previewText()).toBe('a red cat')
    })

    it('truncates a long prompt responsively and exposes the full text with a copy action', async () => {
      const prompt = 'a red cat wearing a tiny hat'
      render(<Artboard painting={makePainting({ prompt })} isLoading={false} />)

      const preview = document.querySelector('.truncate') as HTMLElement
      // The full prompt stays in the DOM (and popover); the `.truncate` class clips
      // it to the available width via CSS rather than a fixed-length JS slice.
      expect(preview.textContent).toBe(prompt)
      expect(preview).toHaveClass('truncate')
      expect(preview.closest('.flex-1')).toHaveClass('min-w-0', 'max-w-xs', 'overflow-hidden')
      const trigger = screen.getByRole('button', { name: prompt })
      expect(trigger).toHaveAttribute('type', 'button')
      expect(trigger).toContainElement(preview)
      expect(trigger).toHaveClass('focus-visible:bg-accent', 'focus-visible:text-foreground')
      expect(trigger.className).not.toMatch(/focus-visible:ring-(?!0)/)

      const zoomButton = screen.getByRole('button', { name: 'preview.zoom_in' })
      zoomButton.focus()
      firePointer(trigger, 'pointerover', { pointerType: 'mouse' })

      const popoverContent = await screen.findByRole('dialog', { name: 'common.prompt' })
      const copyButtons = screen.getAllByRole('button', { name: 'common.copy' })
      expect(copyButtons).toHaveLength(1)
      const copyButton = copyButtons[0]
      expect(zoomButton).toHaveFocus()
      expect(popoverContent).toHaveTextContent(prompt)
      expect(popoverContent.querySelector('.float-right')).toBe(copyButton)
      expect(popoverContent).toHaveClass('bg-neutral-900', 'text-neutral-50', 'shadow-md')
      expect(copyButton).toHaveClass(
        'float-right',
        'ml-0.5',
        'size-5',
        'text-neutral-50',
        'focus-visible:bg-neutral-50/10',
        '[&_svg]:stroke-neutral-50!',
        '[&_svg]:text-neutral-50!'
      )
      expect(copyButton.className).not.toMatch(/focus-visible:ring-(?!0)/)
      expect(copyButton).not.toHaveClass('absolute', 'bg-neutral-700')

      fireEvent.click(copyButton)

      await waitFor(() => expect(mockWriteText).toHaveBeenCalledWith(prompt))
    })

    it.each(['Enter', ' '])('opens from the keyboard with %j and focuses the copy action', async (key) => {
      const prompt = 'a red cat wearing a tiny hat'
      render(<Artboard painting={makePainting({ prompt })} isLoading={false} />)

      const trigger = screen.getByRole('button', { name: prompt })
      trigger.focus()
      expect(screen.queryByRole('dialog', { name: 'common.prompt' })).not.toBeInTheDocument()

      fireEvent.keyDown(trigger, { key })

      const popoverContent = await screen.findByRole('dialog', { name: 'common.prompt' })
      expect(popoverContent).toHaveAccessibleName('common.prompt')
      await waitFor(() => expect(screen.getByRole('button', { name: 'common.copy' })).toHaveFocus())
    })

    it('closes with Escape, returns focus to the trigger, and does not reopen on restored focus', async () => {
      const prompt = 'a red cat wearing a tiny hat'
      render(<Artboard painting={makePainting({ prompt })} isLoading={false} />)

      const trigger = screen.getByRole('button', { name: prompt })
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'Enter' })

      const copyButton = await screen.findByRole('button', { name: 'common.copy' })
      await waitFor(() => expect(copyButton).toHaveFocus())
      fireEvent.keyDown(copyButton, { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'common.prompt' })).not.toBeInTheDocument())
      expect(trigger).toHaveFocus()
      expect(screen.queryByRole('dialog', { name: 'common.prompt' })).not.toBeInTheDocument()
    })

    it('does not open or redirect focus when tabbing from the trigger', () => {
      const prompt = 'a red cat wearing a tiny hat'
      render(<Artboard painting={makePainting({ prompt })} isLoading={false} />)

      const trigger = screen.getByRole('button', { name: prompt })
      trigger.focus()
      const tabEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' })
      fireEvent(trigger, tabEvent)

      expect(tabEvent.defaultPrevented).toBe(false)
      expect(screen.queryByRole('dialog', { name: 'common.prompt' })).not.toBeInTheDocument()
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
        clientHeight = vi
          .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
          .mockImplementation(function (this: HTMLElement) {
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

        expect(screen.getByTestId('artboard-image-layout').style.width).toBe('376px')
      })

      it('re-measures when switching to a differently sized generated image', () => {
        render(<Artboard painting={makePainting({ prompt: 'a red cat' })} isLoading={false} />)

        fireEvent.load(document.querySelector('img') as HTMLImageElement)
        expect(screen.getByTestId('artboard-image-layout').style.width).toBe('376px')

        fireEvent.click(screen.getByRole('button', { name: 'preview.next' }))

        // The new image hasn't reported its natural size yet — falls back to filling
        // the container instead of carrying over the previous image's locked width.
        expect(screen.getByTestId('artboard-image-layout').style.width).toBe('')
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

        expect(screen.getByTestId('artboard-image-layout').style.width).toBe('376px')
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

  it('transforms only the image while keeping the prompt fixed', () => {
    render(
      <Artboard painting={makePainting({ prompt: 'a long prompt that must stay above the image' })} isLoading={false} />
    )

    const image = document.querySelector('img') as HTMLImageElement
    const transformTarget = screen.getByTestId('artboard-image-transform')
    const promptBar = screen.getByTestId('artboard-prompt-bar-measure')

    fireEvent.click(screen.getByRole('button', { name: 'preview.rotate_left' }))
    firePointer(image, 'pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    firePointer(image, 'pointermove', { clientX: 35, clientY: 45, pointerId: 1 })

    expect(transformTarget.style.transform).toBe('translate(25px, 35px) scale(1) rotate(-90deg)')
    expect(promptBar.style.transform).toBe('')
    expect(image).not.toHaveClass('bg-secondary')
    expect(document.querySelector('.truncate')).toHaveTextContent('a long prompt that must stay above the image')

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.rotate_right' }))

    expect(transformTarget.style.transform).toBe('translate(0px, 0px) scale(1) rotate(90deg)')
    expect(promptBar.style.transform).toBe('')
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

  it('promotes the image to a compositor layer only while dragging', () => {
    render(<Artboard painting={makePainting()} isLoading={false} />)

    const image = document.querySelector('img') as HTMLImageElement

    firePointer(image, 'pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    expect(image).toHaveClass('will-change-transform')

    firePointer(image, 'pointerup', { clientX: 10, clientY: 10, pointerId: 1 })
    expect(image).not.toHaveClass('will-change-transform')
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
