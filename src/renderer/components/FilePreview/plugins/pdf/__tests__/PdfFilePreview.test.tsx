import type { FilePath } from '@shared/types/file'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PdfFilePreview from '../PdfFilePreview'

const mocks = vi.hoisted(() => ({
  eventBusOff: vi.fn(),
  eventBusOn: vi.fn(),
  fsRead: vi.fn(),
  getMetadata: vi.fn(),
  safeOpen: vi.fn(),
  toastError: vi.fn(),
  getDocument: vi.fn(),
  linkServiceSetDocument: vi.fn(),
  linkServiceSetViewer: vi.fn(),
  loadingTaskDestroy: vi.fn(),
  pdfDocument: {
    destroy: vi.fn(),
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
  viewerInstances: [] as Array<{ pageColors: { background?: string; foreground: string } }>
}))

vi.mock('pdfjs-dist', () => ({
  AnnotationMode: { ENABLE: 1 },
  GlobalWorkerOptions: { workerSrc: '' },
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
    setDocument = mocks.linkServiceSetDocument
    setViewer = mocks.linkServiceSetViewer
  }

  class MockPDFViewer {
    cleanup = mocks.pdfViewerCleanup
    firstPagePromise = Promise.resolve()
    pageColors: { background?: string; foreground: string }
    setDocument = mocks.pdfViewerSetDocument
    private currentPage = 1
    private scale = 1

    constructor(
      private options: {
        eventBus: MockEventBus
        pageColors: { background?: string; foreground: string }
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
      this.scale = Number.isFinite(Number(value)) ? Number(value) : 1
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
        this.scale *= scaleFactor
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

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  EmptyState: ({
    title,
    description,
    actionLabel,
    onAction
  }: {
    title: string
    description?: string
    actionLabel?: string
    onAction?: () => void
  }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
      {actionLabel ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
  Scrollbar: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: mocks.safeOpen
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

const filePath = '/tmp/workspace/paper.pdf' as FilePath

function renderPreview(refreshKey = 0) {
  return render(<PdfFilePreview filePath={filePath} fileName="paper.pdf" refreshKey={refreshKey} />)
}

async function flushPdfEffects() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('PdfFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pdfViewerPageNumbers.length = 0
    mocks.pdfViewerScaleValues.length = 0
    mocks.viewerInstances.length = 0
    mocks.pdfDocument.numPages = 3
    document.documentElement.style.setProperty('--color-background', 'rgb(10, 11, 12)')
    mocks.fsRead.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 1024 })
    mocks.safeOpen.mockResolvedValue(undefined)
    mocks.loadingTaskDestroy.mockResolvedValue(undefined)
    mocks.getDocument.mockReturnValue({
      destroy: mocks.loadingTaskDestroy,
      promise: Promise.resolve(mocks.pdfDocument)
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { fs: { read: mocks.fsRead }, file: { getMetadata: mocks.getMetadata } }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty('--color-background')
  })

  it('loads the PDF into a continuous pdf.js viewer below a fixed toolbar', async () => {
    renderPreview()

    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()

    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))
    await waitFor(() => expect(screen.getByTestId('pdf-preview-page-indicator')).toHaveTextContent('1 / 3'))

    expect(mocks.fsRead).toHaveBeenCalledWith(filePath)
    expect(mocks.getDocument).toHaveBeenCalledWith({ data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) })
    expect(mocks.pdfViewerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        annotationMode: 1,
        abortSignal: expect.any(AbortSignal),
        pageColors: { background: 'rgb(10, 11, 12)', foreground: 'CanvasText' },
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
      origin: [24, 36],
      scaleFactor: expect.any(Number)
    })
  })

  it('updates PDF page colors when the app theme changes without rebuilding the viewer', async () => {
    renderPreview()
    await waitFor(() => expect(mocks.viewerInstances).toHaveLength(1))

    document.documentElement.style.setProperty('--color-background', 'rgb(30, 31, 32)')

    await waitFor(() =>
      expect(mocks.viewerInstances[0].pageColors).toEqual({
        background: 'rgb(30, 31, 32)',
        foreground: 'CanvasText'
      })
    )
    expect(mocks.pdfViewerConstructor).toHaveBeenCalledTimes(1)
  })

  it('shows a localized generic error without exposing parser details', async () => {
    const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    mocks.fsRead.mockRejectedValueOnce(new Error('sensitive parser details'))

    renderPreview()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('file_preview.load_error.description')
    expect(screen.queryByText('sensitive parser details')).not.toBeInTheDocument()
    expect(loggerError).toHaveBeenCalledWith(
      `Failed to load PDF preview: ${filePath}`,
      expect.objectContaining({ message: 'sensitive parser details' })
    )
  })

  it('rejects oversized PDFs via metadata before reading bytes and offers an external open', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 50 * 1024 * 1024 + 1 })

    renderPreview()

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.pdf.too_large.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('file_preview.pdf.too_large.description')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.getDocument).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.pdf.too_large.action' }))
    await waitFor(() => expect(mocks.safeOpen).toHaveBeenCalledTimes(1))
  })

  it('reloads the document when the refresh key changes', async () => {
    const view = renderPreview()
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))

    view.rerender(<PdfFilePreview filePath={filePath} fileName="paper.pdf" refreshKey={1} />)

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
    expect(mocks.fsRead).toHaveBeenLastCalledWith(filePath)
  })

  it('destroys loading, document, viewer, event, timer, and animation resources on unmount', async () => {
    const { unmount } = renderPreview()
    await waitFor(() => expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(mocks.pdfDocument))

    const container = screen.getByTestId('pdfjs-viewer-container')
    const { abortSignal } = mocks.pdfViewerConstructor.mock.calls[0][0] as { abortSignal: AbortSignal }
    const removeEventListener = vi.spyOn(container, 'removeEventListener')
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
    container.dispatchEvent(new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -10 }))

    unmount()
    await act(flushPdfEffects)

    expect(mocks.loadingTaskDestroy).toHaveBeenCalled()
    expect(abortSignal.aborted).toBe(true)
    expect(mocks.pdfViewerSetDocument).toHaveBeenCalledWith(null)
    expect(mocks.pdfViewerCleanup).toHaveBeenCalled()
    expect(mocks.eventBusOff).toHaveBeenCalledTimes(4)
    expect(removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(clearTimeout).toHaveBeenCalled()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
