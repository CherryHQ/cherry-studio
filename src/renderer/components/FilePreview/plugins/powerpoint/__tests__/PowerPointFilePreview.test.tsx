// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockViewerOptions {
  onSlideChange?: (index: number) => void
}

const mocks = vi.hoisted(() => {
  const createMockPresentation = () => ({
    slides: [
      {
        // marker identifies this slide to the buildTextIndex mock below, since the plugin now
        // narrows every call to a one-slide `{ ...presentation, slides: [slideData] }` view.
        marker: 0,
        rels: new Map([
          [
            'rEmbeddedImage',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
              target: '../media/image1.png'
            }
          ],
          [
            'rExternalImage',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
              target: 'https://example.com/image.png',
              targetMode: 'External'
            }
          ],
          [
            'rExternalHyperlink',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
              target: 'https://example.com',
              targetMode: 'External'
            }
          ]
        ])
      },
      { marker: 1, rels: new Map() },
      { marker: 2, rels: new Map() }
    ],
    layouts: new Map(),
    masters: new Map()
  })

  /**
   * What `buildTextIndex` reports for the single-slide view the plugin now passes it, keyed by the
   * requested slide's `marker`: slide 1 (marker 0) has one shape, slide 2 (marker 1) has two plus a
   * master shape the excerpt must ignore, slide 3 (marker 2) has no text. Entries are indexed
   * relative to that one-slide array, so slideIndex/nodePath always read as slide 0.
   */
  const createMockTextIndex = (presentation: { slides: Array<{ marker: number }> }) => {
    switch (presentation.slides[0]?.marker) {
      case 0:
        return [{ slideIndex: 0, nodeId: 'cover', nodePath: 'slides/0/nodes/cover', textKind: 'shape', text: 'Cover' }]
      case 1:
        return [
          { slideIndex: 0, nodeId: 'title', nodePath: 'slides/0/nodes/title', textKind: 'shape', text: 'Roadmap' },
          { slideIndex: 0, nodeId: 'body', nodePath: 'slides/0/nodes/body', textKind: 'shape', text: 'Q3 goals' },
          {
            slideIndex: 0,
            nodeId: 'stamp',
            nodePath: 'slides/0/master/nodes/stamp',
            textKind: 'shape',
            text: 'Confidential'
          }
        ]
      default:
        return []
    }
  }

  const state = {
    buildPresentation: vi.fn(),
    buildTextIndex: vi.fn(),
    destroy: vi.fn(),
    fsRead: vi.fn(),
    goToSlide: vi.fn(),
    load: vi.fn(),
    loggerError: vi.fn(),
    mockFiles: { slides: new Map() },
    parseZipLazyMedia: vi.fn(),
    renderList: vi.fn(),
    setZoom: vi.fn()
  }

  class MockPptxViewer {
    currentSlideIndex = 0
    slideCount = 3
    zoomPercent = 100

    constructor(
      private container: HTMLElement,
      private options: MockViewerOptions
    ) {}

    load(presentation: unknown) {
      state.load(presentation)
    }

    async renderList(options: unknown) {
      state.renderList(options)
      this.container.textContent = 'rendered pptx'
      this.options.onSlideChange?.(0)
    }

    async goToSlide(index: number) {
      state.goToSlide(index)
      this.currentSlideIndex = index
      this.options.onSlideChange?.(index)
    }

    async setZoom(percent: number) {
      state.setZoom(percent)
      this.zoomPercent = percent
    }

    destroy() {
      state.destroy()
    }
  }

  return { ...state, createMockPresentation, createMockTextIndex, MockPptxViewer }
})

vi.mock('@aiden0z/pptx-renderer', () => ({
  buildPresentation: mocks.buildPresentation,
  buildTextIndex: mocks.buildTextIndex,
  parseZipLazyMedia: mocks.parseZipLazyMedia,
  PptxViewer: mocks.MockPptxViewer,
  RECOMMENDED_ZIP_LIMITS: {}
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  Scrollbar: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import PowerPointFilePreview from '../PowerPointFilePreview'

const filePath = '/tmp/presentations/roadmap.pptx' as AbsoluteFilePath

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fsRead.mockResolvedValue(new Uint8Array([80, 75, 3, 4]))
  mocks.parseZipLazyMedia.mockResolvedValue(mocks.mockFiles)
  mocks.buildPresentation.mockImplementation(() => mocks.createMockPresentation())
  mocks.buildTextIndex.mockImplementation((presentation) => mocks.createMockTextIndex(presentation))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { read: mocks.fsRead } }
  })
})

afterEach(cleanup)

describe('PowerPointFilePreview', () => {
  /** Mounts a slide the way PptxViewer.renderList would, and returns it for clicking. */
  function renderSlide(text: string, slideIndex: string | null): HTMLDivElement {
    const container = screen.getByTestId('pptx-viewer-container')
    const slide = document.createElement('div')
    if (slideIndex !== null) slide.setAttribute('data-slide-index', slideIndex)
    slide.textContent = text
    container.appendChild(slide)
    return slide
  }

  function renderWithCapture(onSelectionReference?: (reference: unknown) => void) {
    return render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 9 }}
        refreshKey={0}
        onSelectionReference={onSelectionReference as never}
      />
    )
  }

  it('reports the clicked slide as a reference built from the deck, not the slide element', async () => {
    const onSelectionReference = vi.fn()
    renderWithCapture(onSelectionReference)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    // What the renderer actually paints: shapes and runs glued together, with an injected bullet and
    // a zero-width filler. Reading the excerpt from here would hand office-transform "RoadmapQ3 goals".
    const slide = renderSlide('\u2022Roadmap\u2022Q3 goals\u200b', '1')

    fireEvent.click(slide)

    expect(onSelectionReference).toHaveBeenLastCalledWith({
      path: filePath,
      // data-slide-index is zero-based; the anchor is one-based.
      anchor: { format: 'pptx', slide: 2 },
      // One line per paragraph, collapsed to spaces by createSelectionReference — and no 'Confidential',
      // which the index only carries under the slide's master.
      excerpt: 'Roadmap Q3 goals',
      fileStamp: { size: 1024, mtimeMs: 9 }
    })
    expect(slide).toHaveAttribute('data-pptx-picked', 'true')
    expect(screen.getByTestId('pptx-viewer-container')).toHaveAttribute('data-picker', 'true')
  })

  it('clears the pick when the picked slide is clicked again and reports null outside any slide', async () => {
    const onSelectionReference = vi.fn()
    renderWithCapture(onSelectionReference)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    const slide = renderSlide('Cover', '0')
    const chrome = renderSlide('chrome around the deck', null)

    fireEvent.click(slide)
    fireEvent.click(slide)
    expect(slide).not.toHaveAttribute('data-pptx-picked')
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)

    fireEvent.click(slide)
    fireEvent.click(chrome)
    expect(slide).not.toHaveAttribute('data-pptx-picked')
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
  })

  it('keeps the pick and its marker across a viewer rebuild, and still clears on the next click', async () => {
    const onSelectionReference = vi.fn()
    renderWithCapture(onSelectionReference)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    const slide = renderSlide('Roadmap for Q3', '1')

    fireEvent.click(slide)
    expect(slide).toHaveAttribute('data-pptx-picked', 'true')
    expect(onSelectionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { format: 'pptx', slide: 2 } })
    )
    const callsWhenPicked = onSelectionReference.mock.calls.length

    // What PptxViewer does on zoom: `setZoom` -> `queueRender` -> `container.innerHTML = ''`, then a
    // fresh element per slide. The host still holds the reference, so the pick must survive.
    screen.getByTestId('pptx-viewer-container').replaceChildren()
    const rebuilt = renderSlide('Roadmap for Q3', '1')

    await waitFor(() => expect(rebuilt).toHaveAttribute('data-pptx-picked', 'true'))
    expect(onSelectionReference).toHaveBeenCalledTimes(callsWhenPicked)

    fireEvent.click(rebuilt)

    expect(rebuilt).not.toHaveAttribute('data-pptx-picked')
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
  })

  it('does not mark the deck or react to clicks when the host is not capturing', async () => {
    renderWithCapture(undefined)
    await waitFor(() => expect(screen.getByTestId('pptx-viewer-container')).toBeInTheDocument())
    const slide = renderSlide('Roadmap for Q3', '0')

    fireEvent.click(slide)

    expect(screen.getByTestId('pptx-viewer-container')).not.toHaveAttribute('data-picker')
    expect(slide).not.toHaveAttribute('data-pptx-picked')
  })

  it('does not mark a slide without deck text as picked and reports null', async () => {
    const onSelectionReference = vi.fn()
    renderWithCapture(onSelectionReference)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    const picked = renderSlide('Roadmap for Q3', '1')
    fireEvent.click(picked)
    expect(picked).toHaveAttribute('data-pptx-picked', 'true')

    // Slide 3 (index 2) carries no entry in the text index.
    const empty = renderSlide('', '2')
    fireEvent.click(empty)

    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
    expect(empty).not.toHaveAttribute('data-pptx-picked')
    expect(picked).not.toHaveAttribute('data-pptx-picked')
  })

  it('prevents an external hyperlink from navigating when the click is a pick', async () => {
    const onSelectionReference = vi.fn()
    renderWithCapture(onSelectionReference)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    const slide = renderSlide('see ', '1')
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    link.textContent = 'ref'
    slide.appendChild(link)

    let observed: boolean | undefined
    // jsdom attempts a real navigation for an unprevented click on an <a href>, logging "Not
    // implemented: navigation" noise; observe defaultPrevented as the event reaches document, then
    // cancel it ourselves so jsdom never gets there.
    const observe = (event: Event) => {
      observed = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', observe)
    try {
      fireEvent.click(link)
    } finally {
      document.removeEventListener('click', observe)
    }

    expect(observed).toBe(true)
    expect(onSelectionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { format: 'pptx', slide: 2 } })
    )

    cleanup()
    renderWithCapture(undefined)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    const plainSlide = renderSlide('see ', '1')
    const plainLink = document.createElement('a')
    plainLink.href = 'https://example.com/'
    plainLink.textContent = 'ref'
    plainSlide.appendChild(plainLink)

    document.addEventListener('click', observe)
    try {
      fireEvent.click(plainLink)
    } finally {
      document.removeEventListener('click', observe)
    }

    expect(observed).toBe(false)
  })

  it('loads and renders PPTX slides with a centered standalone toolbar', async () => {
    render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    expect(mocks.fsRead).toHaveBeenCalledWith(filePath)
    expect(new Uint8Array(mocks.parseZipLazyMedia.mock.calls[0][0])).toEqual(new Uint8Array([80, 75, 3, 4]))
    expect(mocks.buildPresentation).toHaveBeenCalledWith(mocks.mockFiles, { lazySlides: true })
    expect(mocks.renderList).toHaveBeenCalledWith({
      windowed: true,
      batchSize: 4,
      initialSlides: 3,
      overscanViewport: 2
    })
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    expect(toolbar).toHaveClass('h-11', 'min-h-11')
    expect(toolbar).not.toHaveClass('bg-background')
    expect(toolbar.firstElementChild).toHaveClass('mx-auto', 'justify-center')
    expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    await waitFor(() => expect(mocks.goToSlide).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('2 / 3'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    await waitFor(() => expect(mocks.setZoom).toHaveBeenCalledWith(110))
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('110%')
  })

  it('removes external media relationships before loading the viewer', async () => {
    render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    const presentation = mocks.load.mock.calls[0][0]
    expect(presentation.slides[0].rels.has('rEmbeddedImage')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalHyperlink')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalImage')).toBe(false)
  })

  it('rejects oversized PPTX via metadata before reading bytes', async () => {
    render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 25 * 1024 * 1024 + 1, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.parseZipLazyMedia).not.toHaveBeenCalled()
  })

  it('contains read failures inside the preview and logs the cause', async () => {
    const error = new Error('corrupt pptx')
    mocks.fsRead.mockRejectedValueOnce(error)

    render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(mocks.loggerError).toHaveBeenCalledWith(`Failed to load PPTX preview: ${filePath}`, error)
  })

  it('rebuilds and destroys the viewer when refreshKey changes', async () => {
    const view = render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={0}
      />
    )
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    view.rerender(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 1024, modifiedAt: 1 }}
        refreshKey={1}
      />
    )

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
})
