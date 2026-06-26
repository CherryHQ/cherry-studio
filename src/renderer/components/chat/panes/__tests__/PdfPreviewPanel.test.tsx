import { act, fireEvent, render, type RenderResult, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PdfPreviewPanel from '../PdfPreviewPanel'

const mocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  getDocument: vi.fn(),
  loadingTaskDestroy: vi.fn(),
  pdfDocumentDestroy: vi.fn(),
  pdfDocument: {
    destroy: vi.fn(),
    numPages: 1
  },
  eventBusOn: vi.fn(),
  eventBusOff: vi.fn(),
  linkServiceSetDocument: vi.fn(),
  linkServiceSetViewer: vi.fn(),
  pdfViewerCleanup: vi.fn(),
  pdfViewerConstructor: vi.fn(),
  pdfViewerDecreaseScale: vi.fn(),
  pdfViewerIncreaseScale: vi.fn(),
  pdfViewerUpdateScale: vi.fn(),
  nextFirstPagePromises: [] as Array<Promise<void>>,
  pdfViewerPageNumbers: [] as number[],
  pdfViewerInstances: [] as Array<{
    cleanup: ReturnType<typeof vi.fn>
    decreaseScale: (options?: unknown) => void
    firstPagePromise: Promise<void>
    increaseScale: (options?: unknown) => void
    pageColors: unknown
    setDocument: ReturnType<typeof vi.fn>
    updateScale: (options?: unknown) => void
  }>,
  pdfViewerSetDocument: vi.fn(),
  pdfViewerScaleValues: [] as string[]
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: ''
  },
  getDocument: mocks.getDocument
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'pdf.worker.test.mjs'
}))

vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}))

vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => {
  type EventBusListener = (event?: unknown) => void

  class MockEventBus {
    private listeners = new Map<string, Set<EventBusListener>>()

    on(eventName: string, listener: EventBusListener) {
      mocks.eventBusOn(eventName, listener)
      const eventListeners = this.listeners.get(eventName) ?? new Set<EventBusListener>()
      eventListeners.add(listener)
      this.listeners.set(eventName, eventListeners)
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
    setDocument = mocks.linkServiceSetDocument
    setViewer = mocks.linkServiceSetViewer
  }

  class MockPDFViewer {
    cleanup = mocks.pdfViewerCleanup
    private currentPageNumberValue = 1
    private scale = 1
    private eventBus: MockEventBus
    firstPagePromise: Promise<void>
    pageColors: unknown
    setDocument = mocks.pdfViewerSetDocument

    constructor(options: unknown) {
      const { container, eventBus, pageColors } = options as {
        container: HTMLDivElement
        eventBus: MockEventBus
        pageColors?: unknown
      }
      if (container.isConnected && getComputedStyle(container).position !== 'absolute') {
        throw new Error('The `container` must be absolutely positioned.')
      }

      this.eventBus = eventBus
      this.pageColors = pageColors
      this.firstPagePromise = mocks.nextFirstPagePromises.shift() ?? Promise.resolve()
      mocks.pdfViewerConstructor(options)
      mocks.pdfViewerInstances.push(this)
    }

    get currentPageNumber() {
      return this.currentPageNumberValue
    }

    set currentPageNumber(value: number) {
      this.currentPageNumberValue = value
      mocks.pdfViewerPageNumbers.push(value)
      this.eventBus.dispatch('pagechanging', { pageNumber: value })
    }

    get currentScale() {
      return this.scale
    }

    set currentScaleValue(value: string) {
      mocks.pdfViewerScaleValues.push(value)
      const numericScale = Number(value)
      this.scale = Number.isFinite(numericScale) ? numericScale : 1
      this.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    increaseScale = (options?: unknown) => {
      mocks.pdfViewerIncreaseScale(options)
      this.scale = Number((this.scale + 0.1).toFixed(2))
      this.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    decreaseScale = (options?: unknown) => {
      mocks.pdfViewerDecreaseScale(options)
      this.scale = Number((this.scale - 0.1).toFixed(2))
      this.eventBus.dispatch('scalechanging', { scale: this.scale })
    }

    updateScale = (options?: unknown) => {
      mocks.pdfViewerUpdateScale(options)
      const scaleFactor = (options as { scaleFactor?: number } | undefined)?.scaleFactor
      if (typeof scaleFactor === 'number') {
        this.scale = Number((this.scale * scaleFactor).toFixed(2))
        this.eventBus.dispatch('scalechanging', { scale: this.scale })
      }
    }
  }

  return {
    EventBus: MockEventBus,
    PDFLinkService: MockPDFLinkService,
    PDFViewer: MockPDFViewer
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ label }: { label?: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('lucide-react', () => ({
  AlertCircle: (props: PropsWithChildren<React.SVGProps<SVGSVGElement>>) => <svg aria-hidden="true" {...props} />
}))

const flushPdfEffects = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const renderPdfPreviewPanel = async (props: React.ComponentProps<typeof PdfPreviewPanel>): Promise<RenderResult> => {
  let result: RenderResult | undefined

  await act(async () => {
    result = render(<PdfPreviewPanel {...props} />)
    await flushPdfEffects()
  })

  return result!
}

describe('PdfPreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pdfViewerInstances.length = 0
    mocks.pdfViewerPageNumbers.length = 0
    mocks.pdfViewerScaleValues.length = 0
    mocks.nextFirstPagePromises.length = 0
    mocks.pdfDocument.numPages = 1
    document.documentElement.style.setProperty('--color-background', 'rgb(10, 11, 12)')

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          read: mocks.fsRead
        }
      }
    })

    mocks.pdfDocument.destroy = mocks.pdfDocumentDestroy
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.getDocument.mockReturnValue({
      destroy: mocks.loadingTaskDestroy,
      promise: Promise.resolve(mocks.pdfDocument)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty('--color-background')
  })

  it('loads the PDF and initializes the pdf.js viewer with the resolved theme background', async () => {
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')
    const viewer = screen.getByTestId('pdfjs-viewer')

    expect(viewerContainer).toHaveClass('absolute', 'inset-0')
    expect(viewerContainer).toHaveStyle({
      inset: '0',
      position: 'absolute'
    })
    expect(mocks.fsRead).toHaveBeenCalledWith('/tmp/workspace/paper.pdf')
    expect(mocks.getDocument).toHaveBeenCalledWith({ data: new Uint8Array([1, 2, 3]) })
    expect(mocks.pdfViewerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        container: viewerContainer,
        eventBus: expect.any(Object),
        linkService: expect.any(Object),
        pageColors: {
          background: 'rgb(10, 11, 12)',
          foreground: 'CanvasText'
        },
        supportsPinchToZoom: true,
        viewer
      })
    )
    expect(mocks.linkServiceSetViewer).toHaveBeenCalledWith(mocks.pdfViewerInstances[0])
    expect(mocks.linkServiceSetDocument).toHaveBeenCalledWith(mocks.pdfDocument)
    expect(mocks.pdfViewerScaleValues).toContain('page-width')
    expect(viewer).toHaveClass('pdfViewer')
    expect(viewer.style.getPropertyValue('--page-bg-color')).toBe('rgb(10, 11, 12)')
  })

  it('does not apply a hardcoded page background when no app background can be resolved', async () => {
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: '',
      getPropertyValue: () => '',
      position: 'absolute'
    } as unknown as CSSStyleDeclaration)

    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))

    expect(mocks.pdfViewerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        pageColors: {
          foreground: 'CanvasText'
        }
      })
    )
    expect(screen.getByTestId('pdfjs-viewer').style.getPropertyValue('--page-bg-color')).toBe('')

    getComputedStyleSpy.mockRestore()
  })

  it('renders page controls and zoom toolbar for the pdf.js viewer', async () => {
    mocks.pdfDocument.numPages = 3
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalled())

    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))
    expect(screen.getByTestId('pdf-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    expect(mocks.pdfViewerPageNumbers).toContain(2)
    expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('2 / 3')

    fireEvent.click(screen.getByRole('button', { name: 'common.previous' }))
    expect(mocks.pdfViewerPageNumbers).toContain(1)
    expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3')

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(mocks.pdfViewerIncreaseScale).toHaveBeenCalledWith(expect.objectContaining({ drawingDelay: 400 }))
    expect(screen.getByTestId('pdf-preview-zoom-value')).toHaveTextContent('110%')

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    expect(mocks.pdfViewerDecreaseScale).toHaveBeenCalledWith(expect.objectContaining({ drawingDelay: 400 }))
    expect(screen.getByTestId('pdf-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(mocks.pdfViewerScaleValues).toContain('page-width')
  })

  it('coalesces pinch wheel zooms into one small rAF scale update while keeping keyboard zooms immediate', async () => {
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalled())

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')

    await waitFor(() => expect(viewerContainer).toHaveFocus())

    vi.useFakeTimers()

    viewerContainer.dispatchEvent(
      new WheelEvent('wheel', { cancelable: true, clientX: 24, clientY: 36, ctrlKey: true, deltaY: -10 })
    )
    viewerContainer.dispatchEvent(
      new WheelEvent('wheel', { cancelable: true, clientX: 24, clientY: 36, ctrlKey: true, deltaY: -400 })
    )

    expect(mocks.pdfViewerUpdateScale).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(16)
    })

    expect(mocks.pdfViewerUpdateScale).toHaveBeenCalledTimes(1)
    expect(mocks.pdfViewerUpdateScale).toHaveBeenCalledWith({ origin: [24, 36], scaleFactor: expect.any(Number) })
    expect(mocks.pdfViewerUpdateScale.mock.calls[0][0].scaleFactor).toBeGreaterThan(1.02)
    expect(mocks.pdfViewerUpdateScale.mock.calls[0][0].scaleFactor).toBeLessThanOrEqual(1.06)
    expect(mocks.pdfViewerIncreaseScale).not.toHaveBeenCalled()
    expect(mocks.pdfViewerDecreaseScale).not.toHaveBeenCalled()

    fireEvent.keyDown(viewerContainer, { ctrlKey: true, key: '+' })
    expect(mocks.pdfViewerIncreaseScale).toHaveBeenCalledTimes(1)
    expect(mocks.pdfViewerIncreaseScale).toHaveBeenLastCalledWith(expect.objectContaining({ drawingDelay: 400 }))

    fireEvent.keyDown(viewerContainer, { ctrlKey: true, key: '-' })
    expect(mocks.pdfViewerDecreaseScale).toHaveBeenCalledWith(expect.objectContaining({ drawingDelay: 400 }))

    fireEvent.keyDown(viewerContainer, { ctrlKey: true, key: '0' })
    expect(mocks.pdfViewerScaleValues).toContain('page-width')

    vi.useRealTimers()
  })

  it('keeps every pinch wheel scale factor within a small per-frame range', async () => {
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalled())

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')

    vi.useFakeTimers()

    viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -400 }))

    await act(async () => {
      vi.advanceTimersByTime(16)
    })

    expect(mocks.pdfViewerUpdateScale.mock.calls[0][0].scaleFactor).toBeGreaterThan(1.02)
    expect(mocks.pdfViewerUpdateScale.mock.calls[0][0].scaleFactor).toBeLessThanOrEqual(1.06)

    viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: 400 }))

    await act(async () => {
      vi.advanceTimersByTime(16)
    })

    expect(mocks.pdfViewerUpdateScale.mock.calls[1][0].scaleFactor).toBeGreaterThanOrEqual(0.94)
    expect(mocks.pdfViewerUpdateScale.mock.calls[1][0].scaleFactor).toBeLessThan(0.98)

    vi.useRealTimers()
  })

  it('accumulates small trackpad wheel deltas into a visible rAF zoom step', async () => {
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalled())

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')

    vi.useFakeTimers()

    for (let i = 0; i < 3; i += 1) {
      viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -0.2 }))

      await act(async () => {
        vi.advanceTimersByTime(16)
      })
    }

    expect(mocks.pdfViewerUpdateScale).not.toHaveBeenCalled()

    viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -0.2 }))

    await act(async () => {
      vi.advanceTimersByTime(16)
    })

    expect(mocks.pdfViewerUpdateScale).toHaveBeenCalledWith({ origin: [0, 0], scaleFactor: expect.any(Number) })
    expect(mocks.pdfViewerUpdateScale.mock.calls[0][0].scaleFactor).toBeGreaterThan(1)

    vi.useRealTimers()
  })

  it('resets small pinch wheel accumulation after idle gaps', async () => {
    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/paper.pdf', fileName: 'paper.pdf', refreshKey: 0 })
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalled())

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')

    vi.useFakeTimers()

    for (let i = 0; i < 3; i += 1) {
      viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -0.2 }))

      await act(async () => {
        vi.advanceTimersByTime(16)
      })
    }

    expect(mocks.pdfViewerUpdateScale).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(181)
    })

    viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -0.2 }))

    await act(async () => {
      vi.advanceTimersByTime(16)
    })

    expect(mocks.pdfViewerUpdateScale).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('shows the existing error state when the PDF cannot be loaded', async () => {
    let rejectLoad!: (error: Error) => void
    mocks.getDocument.mockReturnValueOnce({
      destroy: mocks.loadingTaskDestroy,
      promise: new Promise((_, reject) => {
        rejectLoad = reject
      })
    })

    await renderPdfPreviewPanel({ filePath: '/tmp/workspace/broken.pdf', fileName: 'broken.pdf', refreshKey: 0 })
    await act(async () => {
      rejectLoad(new Error('PDF failed'))
      await flushPdfEffects()
    })

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error'))
    expect(screen.getByTestId('empty-state')).toHaveTextContent('PDF failed')
  })

  it('ignores stale pdf.js viewer initialization failures after refresh creates a new viewer', async () => {
    let rejectStaleFirstPage!: (error: Error) => void
    mocks.nextFirstPagePromises.push(
      new Promise((_, reject) => {
        rejectStaleFirstPage = reject
      }),
      Promise.resolve()
    )

    const { rerender } = await renderPdfPreviewPanel({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 0
    })

    await waitFor(() => expect(mocks.pdfViewerInstances).toHaveLength(1))

    rerender(<PdfPreviewPanel filePath="/tmp/workspace/paper.pdf" fileName="paper.pdf" refreshKey={1} />)

    await waitFor(() => expect(mocks.pdfViewerInstances).toHaveLength(2))

    await act(async () => {
      rejectStaleFirstPage(new Error('stale first page failed'))
      await flushPdfEffects()
    })

    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument()
  })

  it('destroys an in-flight loading task and resolved document after unmount', async () => {
    const pendingDocument = { destroy: vi.fn(), numPages: 1 }
    let resolveLoad!: (document: typeof pendingDocument) => void
    mocks.getDocument.mockReturnValueOnce({
      destroy: mocks.loadingTaskDestroy,
      promise: new Promise((resolve) => {
        resolveLoad = resolve
      })
    })

    const { unmount } = await renderPdfPreviewPanel({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 0
    })

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalled())

    unmount()

    expect(mocks.loadingTaskDestroy).toHaveBeenCalled()

    await act(async () => {
      resolveLoad(pendingDocument)
      await flushPdfEffects()
    })

    expect(pendingDocument.destroy).toHaveBeenCalled()
    expect(mocks.pdfViewerSetDocument).not.toHaveBeenCalled()
  })

  it('cleans up stale in-flight PDF loads when refresh starts a new load', async () => {
    const staleDocument = { destroy: vi.fn(), numPages: 1 }
    let resolveStaleLoad!: (document: typeof staleDocument) => void
    mocks.getDocument.mockReturnValueOnce({
      destroy: mocks.loadingTaskDestroy,
      promise: new Promise((resolve) => {
        resolveStaleLoad = resolve
      })
    })

    const { rerender } = await renderPdfPreviewPanel({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 0
    })

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(1))

    rerender(<PdfPreviewPanel filePath="/tmp/workspace/paper.pdf" fileName="paper.pdf" refreshKey={1} />)

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))
    expect(mocks.loadingTaskDestroy).toHaveBeenCalled()

    await act(async () => {
      resolveStaleLoad(staleDocument)
      await flushPdfEffects()
    })

    expect(staleDocument.destroy).toHaveBeenCalled()
    expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument()
  })

  it('detaches the pdf.js viewer and destroys the loaded document on cleanup', async () => {
    const { unmount } = await renderPdfPreviewPanel({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 0
    })

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))

    const viewerContainer = screen.getByTestId('pdfjs-viewer-container')
    vi.useFakeTimers()

    const removeEventListenerSpy = vi.spyOn(viewerContainer, 'removeEventListener')
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame')

    viewerContainer.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -10 }))

    unmount()

    expect(mocks.eventBusOff).toHaveBeenCalledWith('pagesinit', expect.any(Function))
    expect(mocks.eventBusOff).toHaveBeenCalledWith('pagerendered', expect.any(Function))
    expect(mocks.eventBusOff).toHaveBeenCalledWith('pagechanging', expect.any(Function))
    expect(mocks.eventBusOff).toHaveBeenCalledWith('scalechanging', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(clearTimeoutSpy).toHaveBeenCalled()
    expect(cancelAnimationFrameSpy).toHaveBeenCalled()
    expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(null)
    expect(mocks.pdfViewerCleanup).toHaveBeenCalled()
    expect(mocks.pdfDocumentDestroy).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
