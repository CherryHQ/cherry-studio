import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { previewTestDocument } from '../../../__tests__/previewTestDocument'
import { dispatchTouch } from '../../../__tests__/touchEvents'
import { PreviewHostContext } from '../../../previewContext'
import type { PreviewDocument } from '../../../source'
import type { PreviewOptions } from '../../../types'
import PdfFilePreview from '../PdfFilePreview'
import { PdfRangeTooLargeError } from '../PdfFileRangeTransport'

const mocks = vi.hoisted(() => ({
  diagnostic: vi.fn(),
  failDocument: vi.fn(),
  initialScale: 1,
  eventBusOff: vi.fn(),
  eventBusOn: vi.fn(),
  getDocument: vi.fn(),
  requestOpen: vi.fn(),
  unusedRead: vi.fn(),
  readResource: vi.fn(),
  workerCreate: vi.fn(),
  workerDestroy: vi.fn(),
  linkServiceGoToDestination: vi.fn(),
  linkServiceSetDocument: vi.fn(),
  linkServiceSetViewer: vi.fn(),
  loadingTaskDestroy: vi.fn(),
  pdfDocument: {
    destroy: vi.fn(),
    getOutline: vi.fn(),
    getPage: vi.fn(),
    numPages: 3
  },
  pdfViewerCleanup: vi.fn(),
  pdfViewerConstructor: vi.fn(),
  pdfViewerDecreaseScale: vi.fn(),
  pdfViewerIncreaseScale: vi.fn(),
  pdfViewerPageNumbers: [] as number[],
  pdfViewerScaleValues: [] as string[],
  pdfViewerSetDocument: vi.fn(),
  pdfViewerUpdateScale: vi.fn(),
  rangeTransportInstances: [] as Array<{
    abort: ReturnType<typeof vi.fn<(...args: any[]) => any>>
    fail: (error: unknown) => void
    document: PreviewDocument
    length: number
  }>,
  viewerInstances: [] as Array<{ pageColors: { background?: string } | null }>
}))

vi.mock('pdfjs-dist', () => ({
  AnnotationMode: { ENABLE: 1 },
  PDFWorker: class {
    static create(options?: unknown) {
      mocks.workerCreate(options)
      return new this()
    }
    destroy = mocks.workerDestroy
  },
  getDocument: mocks.getDocument
}))

vi.mock('../PdfFileRangeTransport', () => ({
  PDF_RANGE_CHUNK_SIZE_BYTES: 1024 * 1024,
  PdfRangeTooLargeError: class PdfRangeTooLargeError extends RangeError {
    readonly maxRangeLength = 16 * 1024 * 1024
    readonly rangeLength: number

    constructor(
      readonly begin: number,
      readonly end: number
    ) {
      super('PDF byte range is too large to assemble')
      this.name = 'PdfRangeTooLargeError'
      this.rangeLength = end - begin
    }
  },
  PdfFileRangeTransport: class {
    abort = vi.fn()

    constructor(
      readonly document: PreviewDocument,
      private readonly onError: (error: unknown) => void
    ) {
      mocks.rangeTransportInstances.push(this)
    }

    get length() {
      return this.document.size
    }

    fail(error: unknown) {
      this.onError(error)
    }
  }
}))

vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}))

vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  type EventBusListener = (event?: unknown) => void

  class MockEventBus {
    private listeners = new Map<string, Set<EventBusListener>>()

    on(eventName: string, listener: EventBusListener) {
      mocks.eventBusOn(eventName, listener)
      const listeners = this.listeners.get(eventName) ?? new Set<EventBusListener>()
      listeners.add(listener)
      this.listeners.set(eventName, listeners)
    }

    off(eventName: string, listener: EventBusListener) {
      mocks.eventBusOff(eventName, listener)
      this.listeners.get(eventName)?.delete(listener)
    }

    dispatch(eventName: string, event?: unknown) {
      this.listeners.get(eventName)?.forEach((listener) => listener(event))
    }
  }

  class MockPDFLinkService {
    goToDestination = mocks.linkServiceGoToDestination
    setDocument = mocks.linkServiceSetDocument
    setViewer = mocks.linkServiceSetViewer
  }

  class MockPDFViewer {
    cleanup = mocks.pdfViewerCleanup
    firstPagePromise = Promise.resolve()
    pageColors: { background?: string } | null
    setDocument = mocks.pdfViewerSetDocument
    private currentPage = 1
    private scale = 1

    constructor(
      private options: {
        eventBus: MockEventBus
        pageColors: { background?: string } | null
      }
    ) {
      this.pageColors = options.pageColors
      mocks.pdfViewerConstructor(options)
      mocks.viewerInstances.push(this)
    }

    get currentPageNumber() {
      return this.currentPage
    }

    set currentPageNumber(value: number) {
      this.currentPage = value
      mocks.pdfViewerPageNumbers.push(value)
      this.options.eventBus.dispatch('pagechanging', { pageNumber: value })
    }

    get currentScale() {
      return this.scale
    }

    set currentScaleValue(value: string) {
      mocks.pdfViewerScaleValues.push(value)
      this.scale = Number.isFinite(Number(value)) ? Number(value) : mocks.initialScale
      this.options.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    increaseScale(options?: unknown) {
      mocks.pdfViewerIncreaseScale(options)
      this.scale = Number((this.scale + 0.1).toFixed(2))
      this.options.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    decreaseScale(options?: unknown) {
      mocks.pdfViewerDecreaseScale(options)
      this.scale = Number((this.scale - 0.1).toFixed(2))
      this.options.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    updateScale(options?: unknown) {
      mocks.pdfViewerUpdateScale(options)
      const scaleFactor = (options as { scaleFactor?: number } | undefined)?.scaleFactor
      if (typeof scaleFactor === 'number') {
        // Match the engine boundary: pdf.js accepts scales at one-percent precision.
        this.scale = Math.min(10, Math.max(0.1, Math.round(this.scale * scaleFactor * 100) / 100))
        this.options.eventBus.dispatch('scalechanging', { scale: this.scale })
      }
    }
  }

  return {
    EventBus: MockEventBus,
    PDFLinkService: MockPDFLinkService,
    PDFViewer: MockPDFViewer
  }
})

vi.unmock('@cherrystudio/ui')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const resources: { readPdfResource: typeof mocks.readResource; createWorker?: (kind: 'pdf' | 'xlsx') => Worker } = {
  readPdfResource: mocks.readResource
}
let previewOptions: PreviewOptions | undefined

const filePath = '/tmp/workspace/paper.pdf'
let initialDataTheme: string | null
let themeBackground: string

function renderPreview(refreshKey = 0, size = 1024, onSelectionReference?: (reference: unknown) => void) {
  return render(
    <PdfFilePreview
      sourceId={filePath}
      fileName="paper.pdf"
      document={previewTestDocument(size, 1, mocks.unusedRead, refreshKey)}
      onSelection={onSelectionReference as never}
    />,
    {
      wrapper: ({ children }) => (
        <PreviewHostContext
          value={{
            resources,
            options: previewOptions,
            onDiagnostic: mocks.diagnostic,
            failDocument: mocks.failDocument,
            onRequestOpen: mocks.requestOpen
          }}>
          {children}
        </PreviewHostContext>
      )
    }
  )
}

/** Mounts a page the way pdf.js's PDFViewer would, and returns it for clicking. */
function renderPage(pageNumber: string | null): HTMLDivElement {
  const viewer = screen.getByTestId('pdfjs-viewer')
  const page = document.createElement('div')
  page.className = 'page'
  if (pageNumber !== null) page.setAttribute('data-page-number', pageNumber)
  page.textContent = 'rendered page'
  viewer.appendChild(page)
  return page
}

/** The <a href> pdf.js's annotation layer renders for a link annotation. */
function renderLinkAnnotation(page: HTMLDivElement): HTMLAnchorElement {
  const link = document.createElement('a')
  link.href = 'https://example.com/'
  link.textContent = 'ref'
  page.appendChild(link)
  return link
}

async function flushPdfEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('PdfFilePreview', () => {
  it('reports the clicked page as a reference with the page text as excerpt, and marks it as picked', async () => {
    mocks.pdfDocument.getPage.mockResolvedValue({
      getTextContent: async () => ({
        items: [{ str: 'results were' }, { str: 'reproduced' }, { type: 'endOfContent' }]
      })
    })
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('3')

    fireEvent.click(page)

    await waitFor(() =>
      expect(onSelectionReference).toHaveBeenLastCalledWith({
        sourceId: filePath,
        anchor: { format: 'pdf', page: 3 },
        excerpt: 'results were reproduced',
        revision: JSON.stringify({ size: 1024, mtimeMs: 1 })
      })
    )
    expect(mocks.pdfDocument.getPage).toHaveBeenCalledWith(3)
    expect(page).toHaveAttribute('data-pdf-picked', 'true')
    expect(screen.getByTestId('pdfjs-viewer-container')).toHaveAttribute('data-picker', 'true')
  })

  it('clears the pick on a second click and reports null outside any page', async () => {
    mocks.pdfDocument.getPage.mockResolvedValue({ getTextContent: async () => ({ items: [{ str: 'page text' }] }) })
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('2')
    const chrome = renderPage(null)

    fireEvent.click(page)
    await waitFor(() => expect(page).toHaveAttribute('data-pdf-picked', 'true'))
    fireEvent.click(page)
    expect(page).not.toHaveAttribute('data-pdf-picked')
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)

    fireEvent.click(chrome)
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
  })

  it("empties the held reference before the new page's text arrives", async () => {
    mocks.pdfDocument.getPage.mockImplementation(async (pageNumber: number) => ({
      getTextContent: async () => ({ items: [{ str: `page ${pageNumber} text` }] })
    }))
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const firstPage = renderPage('1')
    const secondPage = renderPage('2')

    fireEvent.click(firstPage)
    await waitFor(() =>
      expect(onSelectionReference).toHaveBeenLastCalledWith(
        expect.objectContaining({ anchor: { format: 'pdf', page: 1 } })
      )
    )

    // Nothing is awaited between the click and these assertions, so the page-text microtasks have
    // not run: that is the window in which the host must already hold nothing.
    fireEvent.click(secondPage)

    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
    expect(secondPage).toHaveAttribute('data-pdf-picked', 'true')
    expect(firstPage).not.toHaveAttribute('data-pdf-picked')

    await act(flushPdfEffects)

    expect(onSelectionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchor: { format: 'pdf', page: 2 }, excerpt: 'page 2 text' })
    )
  })

  it('keeps the pick and its marker across a viewer rebuild, and still clears on the next click', async () => {
    mocks.pdfDocument.getPage.mockResolvedValue({ getTextContent: async () => ({ items: [{ str: 'page text' }] }) })
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('2')

    fireEvent.click(page)
    await waitFor(() =>
      expect(onSelectionReference).toHaveBeenLastCalledWith(
        expect.objectContaining({ anchor: { format: 'pdf', page: 2 } })
      )
    )
    const callsWhenPicked = onSelectionReference.mock.calls.length

    // Replacing the viewer's children is what pdf.js does when it re-renders its page list: the pick must
    // survive the rebuild, and the rebuild must report nothing.
    screen.getByTestId('pdfjs-viewer').replaceChildren()
    const rebuilt = renderPage('2')

    await waitFor(() => expect(rebuilt).toHaveAttribute('data-pdf-picked', 'true'))
    expect(onSelectionReference).toHaveBeenCalledTimes(callsWhenPicked)

    fireEvent.click(rebuilt)

    expect(rebuilt).not.toHaveAttribute('data-pdf-picked')
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
  })

  it('does not mark a page whose text is empty and reports null', async () => {
    mocks.pdfDocument.getPage.mockResolvedValue({ getTextContent: async () => ({ items: [] }) })
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('1')

    fireEvent.click(page)

    await waitFor(() => expect(onSelectionReference).toHaveBeenLastCalledWith(null))
    await waitFor(() =>
      expect(screen.getByTestId('pdfjs-viewer').querySelector('[data-pdf-picked]')).not.toBeInTheDocument()
    )
  })

  it('does not report a pick whose text arrives after the preview unmounted', async () => {
    let resolveText: (value: { items: Array<{ str: string }> }) => void = () => {}
    mocks.pdfDocument.getPage.mockResolvedValue({
      getTextContent: () =>
        new Promise((resolve) => {
          resolveText = resolve
        })
    })
    const onSelectionReference = vi.fn()
    const view = renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('2')

    fireEvent.click(page)
    await act(flushPdfEffects)
    const callsBeforeUnmount = onSelectionReference.mock.calls.length

    view.unmount()
    resolveText({ items: [{ str: 'late text' }] })
    await act(flushPdfEffects)

    expect(onSelectionReference).not.toHaveBeenCalledWith(expect.objectContaining({ excerpt: 'late text' }))
    expect(onSelectionReference).toHaveBeenCalledTimes(callsBeforeUnmount)
  })

  it('prevents a link annotation from navigating when the click is a pick', async () => {
    mocks.pdfDocument.getPage.mockResolvedValue({ getTextContent: async () => ({ items: [{ str: 'page text' }] }) })
    const onSelectionReference = vi.fn()
    renderPreview(0, 1024, onSelectionReference)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const link = renderLinkAnnotation(renderPage('1'))

    let observed: boolean | undefined
    // jsdom logs "Not implemented: navigation" for an unprevented <a href> click, so observe
    // defaultPrevented at document and cancel it ourselves before jsdom gets there.
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
    await waitFor(() =>
      expect(onSelectionReference).toHaveBeenLastCalledWith(
        expect.objectContaining({ anchor: { format: 'pdf', page: 1 } })
      )
    )

    cleanup()
    renderPreview(0, 1024, undefined)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const plainLink = renderLinkAnnotation(renderPage('1'))

    document.addEventListener('click', observe)
    try {
      fireEvent.click(plainLink)
    } finally {
      document.removeEventListener('click', observe)
    }

    expect(observed).toBe(false)
  })

  it('does not mark the viewer or react to clicks when the host is not capturing', async () => {
    renderPreview(0, 1024, undefined)
    await act(flushPdfEffects)
    await waitFor(() => expect(screen.getByTestId('pdfjs-viewer-container')).toBeInTheDocument())
    const page = renderPage('1')

    fireEvent.click(page)

    expect(mocks.pdfDocument.getPage).not.toHaveBeenCalled()
    expect(screen.getByTestId('pdfjs-viewer-container')).not.toHaveAttribute('data-picker')
    expect(page).not.toHaveAttribute('data-pdf-picked')
  })

  beforeEach(() => {
    previewOptions = undefined
    mocks.initialScale = 1
    vi.stubGlobal(
      'Worker',
      class {
        terminate = vi.fn()
      }
    )
    vi.clearAllMocks()
    mocks.pdfViewerPageNumbers.length = 0
    mocks.pdfViewerScaleValues.length = 0
    mocks.rangeTransportInstances.length = 0
    mocks.viewerInstances.length = 0
    mocks.pdfDocument.numPages = 3
    mocks.pdfDocument.getPage.mockReset()
    initialDataTheme = document.documentElement.getAttribute('data-theme')
    themeBackground = 'rgb(10, 11, 12)'
    const getPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue
    vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue').mockImplementation(function (
      this: CSSStyleDeclaration,
      property: string
    ) {
      return property === '--background' ? themeBackground : getPropertyValue.call(this, property)
    })
    mocks.loadingTaskDestroy.mockResolvedValue(undefined)
    mocks.linkServiceGoToDestination.mockResolvedValue(undefined)
    mocks.pdfDocument.getOutline.mockResolvedValue([])
    mocks.getDocument.mockReturnValue({
      destroy: mocks.loadingTaskDestroy,
      promise: Promise.resolve(mocks.pdfDocument)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (initialDataTheme === null) {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', initialDataTheme)
    }
  })

  it('loads the PDF into a continuous pdf.js viewer below a fixed toolbar', async () => {
    renderPreview()

    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

    const rangeTransport = mocks.rangeTransportInstances[0]
    expect(rangeTransport).toMatchObject({ document: expect.objectContaining({ size: 1024 }) })
    expect(mocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        range: rangeTransport,
        rangeChunkSize: 1024 * 1024,
        disableAutoFetch: true,
        disableStream: true,
        CMapReaderFactory: expect.any(Function),
        StandardFontDataFactory: expect.any(Function),
        worker: expect.any(Object)
      })
    )
    expect(mocks.pdfViewerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationMode: 1,
        abortSignal: expect.any(AbortSignal),
        pageColors: { background: 'rgb(10, 11, 12)' },
        supportsPinchToZoom: true
      })
    )
    expect(screen.getByTestId('pdfjs-viewer-container')).toHaveClass('absolute', 'inset-0', 'overflow-auto')
    expect(screen.getByTestId('pdfjs-viewer')).toHaveClass('pdfViewer')
    expect(mocks.pdfViewerScaleValues).toContain('page-width')
  })

  it('supports toolbar, focused keyboard, and pointer-centered wheel zoom controls', async () => {
    let animationFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrame = callback
      return 1
    })

    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    expect(mocks.pdfViewerPageNumbers).toContain(2)

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(mocks.pdfViewerIncreaseScale).toHaveBeenCalledWith({ drawingDelay: 400 })
    expect(screen.getByTestId('pdf-preview-zoom-value')).toHaveTextContent('110%')

    const container = screen.getByTestId('pdfjs-viewer-container')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20 }))
    fireEvent.keyDown(container, { ctrlKey: true, key: '0' })
    expect(mocks.pdfViewerScaleValues).toContain('page-width')

    container.dispatchEvent(
      new WheelEvent('wheel', { cancelable: true, clientX: 24, clientY: 36, ctrlKey: true, deltaY: -10 })
    )
    act(() => animationFrame?.(0))

    expect(mocks.pdfViewerUpdateScale).toHaveBeenCalledWith({
      origin: [14, 16],
      scaleFactor: expect.any(Number)
    })
  })

  it('zooms around the fingers on a two-finger pinch instead of zooming the page', async () => {
    let animationFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrame = callback
      return 1
    })
    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
    const zoomBefore = screen.getByTestId('pdf-preview-zoom-value').textContent

    const container = screen.getByTestId('pdfjs-viewer-container')
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 40, y: 50 }))
    Object.defineProperties(container, { offsetLeft: { value: 8 }, offsetTop: { value: 12 } })
    dispatchTouch(container, 'touchstart', [
      [100, 100],
      [200, 100]
    ])
    const pinch = dispatchTouch(container, 'touchmove', [
      [50, 100],
      [250, 100]
    ])
    act(() => animationFrame?.(0))

    expect(pinch.defaultPrevented).toBe(true)
    expect(mocks.pdfViewerUpdateScale).toHaveBeenLastCalledWith({
      drawingDelay: 400,
      origin: [118, 62],
      scaleFactor: 2
    })
    expect(screen.getByTestId('pdf-preview-zoom-value').textContent).not.toBe(zoomBefore)
  })

  it('accumulates slow pinch steps without carrying rounding residue into another gesture', async () => {
    mocks.initialScale = 0.43
    let animationFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrame = callback
      return 1
    })
    renderPreview()
    const zoom = await screen.findByTestId('pdf-preview-zoom-value')
    await waitFor(() => expect(zoom).toHaveTextContent('43%'))
    const container = screen.getByRole('region', { name: 'paper.pdf' })
    const move = (span: number) => {
      dispatchTouch(container, 'touchmove', [
        [0, 0],
        [span, 0]
      ])
      act(() => animationFrame?.(0))
    }

    dispatchTouch(container, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    move(100.6)
    expect(zoom).toHaveTextContent('43%')
    move(101.2)
    expect(zoom).toHaveTextContent('44%')
    dispatchTouch(container, 'touchend', [])

    dispatchTouch(container, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    move(100.8)
    expect(zoom).toHaveTextContent('44%')
    dispatchTouch(container, 'touchcancel', [])
    dispatchTouch(container, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    move(100.8)
    expect(zoom).toHaveTextContent('44%')
  })

  it.each([
    { initialScale: 0.1, outwardSpan: 96, inwardSpan: 101.76, initialLabel: '10%', finalLabel: '11%' },
    { initialScale: 10, outwardSpan: 100.04, inwardSpan: 99.979976, initialLabel: '1000%', finalLabel: '999%' }
  ])(
    'discards even a small overshoot at zoom $initialScale before reversing the pinch',
    async ({ initialScale, outwardSpan, inwardSpan, initialLabel, finalLabel }) => {
      mocks.initialScale = initialScale
      let animationFrame: FrameRequestCallback | undefined
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        animationFrame = callback
        return 1
      })
      renderPreview()
      const zoom = await screen.findByTestId('pdf-preview-zoom-value')
      await waitFor(() => expect(zoom).toHaveTextContent(initialLabel))
      const container = screen.getByRole('region', { name: 'paper.pdf' })

      dispatchTouch(container, 'touchstart', [
        [0, 0],
        [100, 0]
      ])
      dispatchTouch(container, 'touchmove', [
        [0, 0],
        [outwardSpan, 0]
      ])
      act(() => animationFrame?.(0))
      expect(zoom).toHaveTextContent(initialLabel)

      dispatchTouch(container, 'touchmove', [
        [0, 0],
        [inwardSpan, 0]
      ])
      act(() => animationFrame?.(0))
      expect(zoom).toHaveTextContent(finalLabel)
    }
  )

  it.each(['unmount', 'read failure'] as const)(
    'keeps the worker alive until document cleanup completes on %s',
    async (reason) => {
      const hostWorker = { terminate: vi.fn() } as unknown as Worker
      resources.createWorker = () => hostWorker
      let releaseDocument = () => {}
      mocks.loadingTaskDestroy.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseDocument = resolve
          })
      )
      try {
        const view = renderPreview()
        await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
        if (reason === 'unmount') view.unmount()
        else act(() => mocks.rangeTransportInstances[0].fail(new Error('read failed')))

        expect(mocks.loadingTaskDestroy).toHaveBeenCalled()
        expect(hostWorker.terminate).not.toHaveBeenCalled()
        expect(mocks.workerDestroy).not.toHaveBeenCalled()
        await act(async () => {
          releaseDocument()
          await flushPdfEffects()
        })
        expect(hostWorker.terminate).toHaveBeenCalledOnce()
        expect(mocks.workerDestroy).toHaveBeenCalledOnce()
        view.unmount()
        await act(flushPdfEffects)
        expect(hostWorker.terminate).toHaveBeenCalledOnce()
      } finally {
        delete resources.createWorker
      }
    }
  )

  it('releases the worker and reports the cause when document cleanup rejects', async () => {
    const hostWorker = { terminate: vi.fn() } as unknown as Worker
    resources.createWorker = () => hostWorker
    const error = new Error('cleanup failed')
    mocks.loadingTaskDestroy.mockRejectedValueOnce(error)
    try {
      const view = renderPreview()
      await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
      view.unmount()
      await act(flushPdfEffects)
      expect(hostWorker.terminate).toHaveBeenCalledOnce()
      expect(mocks.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', detail: error }))
    } finally {
      delete resources.createWorker
    }
  })

  it('runs pdf.js on the worker the host creates', async () => {
    // An inline WebView bundle has no URL to load the bundled worker from, so the host must supply it.
    const hostWorker = { terminate: vi.fn() } as unknown as Worker
    const createWorker = vi.fn(() => hostWorker)
    resources.createWorker = createWorker
    try {
      const view = renderPreview()
      await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

      expect(createWorker).toHaveBeenCalledWith('pdf')
      expect(mocks.workerCreate).toHaveBeenCalledWith({ port: hostWorker })
      const options = mocks.getDocument.mock.lastCall?.[0]
      expect(options).not.toHaveProperty('cMapUrl')
      expect(options).not.toHaveProperty('standardFontDataUrl')
      expect(options.useWorkerFetch).toBe(false)
      const font = new Uint8Array([1, 2, 3])
      mocks.readResource.mockResolvedValueOnce(font)
      expect(await new options.StandardFontDataFactory().fetch({ filename: 'FoxitSerif.pfb' })).toBe(font)
      expect(mocks.readResource).toHaveBeenCalledWith('standard_font', 'FoxitSerif.pfb')
      view.unmount()
      await act(flushPdfEffects)
      expect(hostWorker.terminate).toHaveBeenCalled()
    } finally {
      delete resources.createWorker
    }
  })

  it('allows text selection and direct page jumps', async () => {
    const user = userEvent.setup()
    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

    // `selectable` overrides the renderer's global user-select:none contract.
    expect(screen.getByTestId('pdfjs-viewer')).toHaveClass('selectable')

    const pageInput = screen.getByRole('textbox', { name: 'file_preview.pdf.page_number' })
    await user.clear(pageInput)
    await user.type(pageInput, '3{Enter}')

    expect(mocks.pdfViewerPageNumbers).toContain(3)
  })

  it.each(['{Enter}', '{Tab}'])('normalizes an out-of-range page at the last page on %s', async (commitKey) => {
    const user = userEvent.setup()
    renderPreview()
    const pageInput = screen.getByRole('textbox', { name: 'file_preview.pdf.page_number' })
    await waitFor(() => expect(pageInput).toBeEnabled())

    await user.clear(pageInput)
    await user.type(pageInput, '3{Enter}')
    await waitFor(() => expect(pageInput).toHaveValue('3'))
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()

    await user.clear(pageInput)
    await user.type(pageInput, `999${commitKey}`)

    expect(pageInput).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()
  })

  it('shows the PDF outline and navigates to its destinations', async () => {
    const user = userEvent.setup()
    const destination = [{ num: 4, gen: 0 }, { name: 'XYZ' }, 0, 0, null]
    mocks.pdfDocument.getOutline.mockResolvedValueOnce([
      {
        title: 'Introduction',
        dest: destination,
        url: null,
        items: [{ title: 'Background', dest: 'background', url: null, items: [] }]
      }
    ])

    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
    await user.click(screen.getByRole('button', { name: 'file_preview.pdf.outline.title' }))

    expect(await screen.findByRole('navigation', { name: 'file_preview.pdf.outline.title' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Background' }))

    expect(mocks.linkServiceGoToDestination).toHaveBeenCalledWith('background')
  })

  it('dismisses an overlay outline with Escape or navigation and restores the appropriate focus', async () => {
    const user = userEvent.setup()
    previewOptions = { pdf: { outlineLayout: 'overlay' } }
    mocks.pdfDocument.getOutline.mockResolvedValueOnce([{ title: 'Introduction', dest: 'intro', url: null, items: [] }])
    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
    const trigger = screen.getByRole('button', { name: 'file_preview.pdf.outline.title' })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'file_preview.pdf.outline.title' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Introduction' }))
    expect(mocks.linkServiceGoToDestination).toHaveBeenCalledWith('intro')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'paper.pdf' })).toHaveFocus()
  })

  it('explains when a PDF has no outline', async () => {
    const user = userEvent.setup()
    renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

    await user.click(screen.getByRole('button', { name: 'file_preview.pdf.outline.title' }))

    expect(await screen.findByText('file_preview.pdf.outline.empty')).toBeInTheDocument()
  })

  it.each(['panel', 'overlay'] as const)(
    'reserves trailing scroll space for the %s outline in content inset mode',
    async (outlineLayout) => {
      previewOptions = { bottomInset: 'content', pdf: { outlineLayout } }
      mocks.pdfDocument.getOutline.mockResolvedValueOnce([
        { title: 'Last section', dest: 'last', url: null, items: [] }
      ])
      renderPreview()
      const user = userEvent.setup()
      await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
      await user.click(screen.getByRole('button', { name: 'file_preview.pdf.outline.title' }))
      const outline = await screen.findByRole('navigation', { name: 'file_preview.pdf.outline.title' })
      // The documented content inset must be inside the outline's scrollable area.
      expect(outline.lastElementChild).toHaveStyle({
        paddingBottom: 'calc(0.5rem + var(--file-preview-bottom-inset, 0px))'
      })
      expect(screen.getByRole('button', { name: 'Last section' })).toBeVisible()
    }
  )

  it('preserves PDF colors while updating the page background when the app theme changes', async () => {
    renderPreview()
    await waitFor(() => expect(mocks.viewerInstances).toHaveLength(1))

    themeBackground = 'rgb(30, 31, 32)'
    document.documentElement.setAttribute(
      'data-theme',
      initialDataTheme === 'pdf-test-theme' ? 'pdf-test-theme-updated' : 'pdf-test-theme'
    )

    await waitFor(() =>
      expect(mocks.viewerInstances[0].pageColors).toEqual({
        background: 'rgb(30, 31, 32)'
      })
    )
    expect(mocks.pdfViewerConstructor).toHaveBeenCalledTimes(1)
  })

  it('reports viewer construction failure once through the terminal error channel', async () => {
    const error = new Error('viewer initialization failed')
    mocks.pdfViewerConstructor.mockImplementationOnce(() => {
      throw error
    })

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.failDocument).toHaveBeenCalledExactlyOnceWith(error)
    expect(mocks.diagnostic).not.toHaveBeenCalled()
    expect(screen.queryByText(error.message)).not.toBeInTheDocument()
  })

  it('shows a localized generic error without exposing parser details', async () => {
    mocks.getDocument.mockReturnValueOnce({
      destroy: mocks.loadingTaskDestroy,
      promise: Promise.reject(new Error('sensitive parser details'))
    })

    renderPreview()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'file_preview.load_error.title' })).toBeInTheDocument()
    expect(screen.getByText('file_preview.load_error.description')).toBeInTheDocument()
    expect(screen.queryByText('sensitive parser details')).not.toBeInTheDocument()
    expect(mocks.failDocument).toHaveBeenCalledWith(expect.objectContaining({ message: 'sensitive parser details' }))
  })

  it('loads PDFs above the former size limit through the range transport', async () => {
    const largePdfSize = 300 * 1024 * 1024
    renderPreview(0, largePdfSize)

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(1))
    expect(mocks.rangeTransportInstances[0]).toMatchObject({ length: largePdfSize })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces range transport failures after document loading starts', async () => {
    renderPreview()
    await waitFor(() => expect(mocks.rangeTransportInstances).toHaveLength(1))

    act(() => mocks.rangeTransportInstances[0].fail(new Error('range read failed')))

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.loadingTaskDestroy).toHaveBeenCalled()
    expect(mocks.failDocument).toHaveBeenCalledWith(expect.objectContaining({ message: 'range read failed' }))
  })

  it('offers the default app when a PDF range exceeds the safe assembled limit', async () => {
    const user = userEvent.setup()
    renderPreview()
    await waitFor(() => expect(mocks.rangeTransportInstances).toHaveLength(1))

    act(() => mocks.rangeTransportInstances[0].fail(new PdfRangeTooLargeError(1024 * 1024, 19 * 1024 * 1024)))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('file_preview.pdf.too_large.title')
    expect(alert).toHaveTextContent('file_preview.pdf.too_large.description')
    expect(mocks.loadingTaskDestroy).toHaveBeenCalled()
    expect(mocks.failDocument).toHaveBeenCalledWith(expect.objectContaining({ code: 'too_large' }))

    await user.click(screen.getByRole('button', { name: 'file_preview.too_large.action' }))

    expect(mocks.requestOpen).toHaveBeenCalledWith('too_large')
  })

  it('reloads the document when the refresh key changes', async () => {
    const view = renderPreview()
    await waitFor(() => expect(mocks.rangeTransportInstances).toHaveLength(1))
    const firstTransport = mocks.rangeTransportInstances[0]

    view.rerender(
      <PdfFilePreview
        sourceId={filePath}
        fileName="paper.pdf"
        document={previewTestDocument(1024, 1, mocks.unusedRead, 1)}
      />
    )

    await waitFor(() => expect(mocks.rangeTransportInstances).toHaveLength(2))
    expect(firstTransport.abort).toHaveBeenCalled()
  })

  it('stops intercepting viewer input after unmount', async () => {
    const { unmount } = renderPreview()
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
    const container = screen.getByRole('region', { name: 'paper.pdf' })
    const { abortSignal } = mocks.pdfViewerConstructor.mock.calls[0][0] as { abortSignal: AbortSignal }

    unmount()
    await act(flushPdfEffects)

    const wheel = new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -10 })
    const keyboard = new KeyboardEvent('keydown', { cancelable: true, ctrlKey: true, key: '+' })
    container.dispatchEvent(wheel)
    container.dispatchEvent(keyboard)
    dispatchTouch(container, 'touchstart', [
      [0, 0],
      [100, 0]
    ])
    const pinch = dispatchTouch(container, 'touchmove', [
      [0, 0],
      [200, 0]
    ])
    expect(wheel.defaultPrevented).toBe(false)
    expect(keyboard.defaultPrevented).toBe(false)
    expect(pinch.defaultPrevented).toBe(false)
    expect(abortSignal.aborted).toBe(true)
  })
})
