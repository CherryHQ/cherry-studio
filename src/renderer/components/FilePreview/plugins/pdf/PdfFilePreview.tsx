import 'pdfjs-dist/web/pdf_viewer.css'

import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy
} from 'pdfjs-dist'
// oxlint-disable-next-line import/default -- Vite exposes ?url imports as default asset URLs.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { PdfFilePreviewToolbar } from './PdfFilePreviewToolbar'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const logger = loggerService.withContext('PdfFilePreview')
const DEFAULT_PDF_SCALE = 'page-width'
const DEFAULT_ZOOM = 1
const PDF_PREVIEW_MAX_SIZE_MIB = 50
const PDF_PREVIEW_MAX_SIZE_BYTES = PDF_PREVIEW_MAX_SIZE_MIB * 1024 * 1024
const ZOOM_DRAWING_DELAY = 400
const PINCH_WHEEL_MIN_DELTA = 0.08
const PINCH_WHEEL_MAX_EVENT_DELTA = 0.8
const PINCH_WHEEL_PIXEL_DIVISOR = 10
const PINCH_WHEEL_IDLE_RESET_MS = 180
const PINCH_SCALE_SENSITIVITY = 0.075
const PDF_PAGE_FOREGROUND = 'CanvasText'

type PdfJsViewer = InstanceType<typeof PDFViewer>
type PdfViewerOptionsWithAbortSignal = ConstructorParameters<typeof PDFViewer>[0] & { abortSignal: AbortSignal }

interface PdfPageChangingEvent {
  pageNumber?: number
}

interface PdfScaleChangingEvent {
  scale?: number
}

function toUint8Array(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function isEffectiveBackground(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized && normalized !== 'transparent' && normalized !== 'rgba(0, 0, 0, 0)')
}

function resolveThemeBackground(element: HTMLElement | null): string | null {
  const candidates = [element, window.root, document.documentElement].filter(Boolean) as HTMLElement[]

  for (const candidate of candidates) {
    const value = getComputedStyle(candidate).getPropertyValue('--color-background').trim()
    if (value) return value
  }

  const backgroundColor = getComputedStyle(document.documentElement).backgroundColor
  return isEffectiveBackground(backgroundColor) ? backgroundColor : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

function normalizePinchWheelDelta(event: WheelEvent): number {
  const divisor =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 30
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 1
        : PINCH_WHEEL_PIXEL_DIVISOR

  return clamp(event.deltaY / divisor, -PINCH_WHEEL_MAX_EVENT_DELTA, PINCH_WHEEL_MAX_EVENT_DELTA)
}

function detachDocument(viewer: PdfJsViewer): void {
  ;(viewer.setDocument as (pdfDocument: PDFDocumentProxy | null) => void)(null)
}

function destroyLoadingTask(loadingTask: PDFDocumentLoadingTask, filePath: string): void {
  void loadingTask.destroy().catch((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to destroy PDF loading task: ${filePath}`, normalized)
  })
}

function PdfPreviewTooLarge({ filePath }: { filePath: FilePath }) {
  const { t } = useTranslation()

  const handleOpenWithDefaultApp = () => {
    void safeOpen(createFilePathHandle(filePath)).catch(() => toast.error(t('file_preview.pdf.too_large.open_error')))
  }

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.pdf.too_large.title')}
        description={t('file_preview.pdf.too_large.description', { limit: PDF_PREVIEW_MAX_SIZE_MIB })}
        actionLabel={t('file_preview.pdf.too_large.action')}
        onAction={handleOpenWithDefaultApp}
        className="h-full"
      />
    </div>
  )
}

export default function PdfFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PdfJsViewer | null>(null)
  const [background, setBackground] = useState(() => resolveThemeBackground(null))
  const backgroundRef = useRef(background)
  backgroundRef.current = background
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<'error' | 'loading' | 'ready' | 'too_large'>('loading')
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const applyViewerBackground = useCallback((nextBackground: string | null) => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (nextBackground) {
      viewer.style.setProperty('--page-bg-color', nextBackground)
    } else {
      viewer.style.removeProperty('--page-bg-color')
    }

    viewer.querySelectorAll<HTMLElement>('.page').forEach((page) => {
      if (nextBackground) {
        page.style.setProperty('--page-bg-color', nextBackground)
      } else {
        page.style.removeProperty('--page-bg-color')
      }
    })
    viewer.querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvas) => {
      canvas.style.backgroundColor = nextBackground ?? ''
    })
  }, [])

  const updateBackground = useCallback(() => {
    const nextBackground = resolveThemeBackground(rootRef.current)
    setBackground(nextBackground)
    applyViewerBackground(nextBackground)
  }, [applyViewerBackground])

  const focusContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      const pdfViewer = pdfViewerRef.current
      if (!pdfViewer || pageCount <= 0) return

      const nextPage = clamp(pageNumber, 1, pageCount)
      pdfViewer.currentPageNumber = nextPage
      setCurrentPage(nextPage)
      focusContainer()
    },
    [focusContainer, pageCount]
  )

  const zoomBy = useCallback(
    (direction: 'in' | 'out') => {
      const pdfViewer = pdfViewerRef.current
      if (!pdfViewer) return

      const options = { drawingDelay: ZOOM_DRAWING_DELAY }
      if (direction === 'in') {
        pdfViewer.increaseScale(options)
      } else {
        pdfViewer.decreaseScale(options)
      }

      if (Number.isFinite(pdfViewer.currentScale) && pdfViewer.currentScale > 0) {
        setZoom(pdfViewer.currentScale)
      }
      focusContainer()
    },
    [focusContainer]
  )

  const resetZoom = useCallback(() => {
    const pdfViewer = pdfViewerRef.current
    if (!pdfViewer) return

    pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
    setZoom(
      Number.isFinite(pdfViewer.currentScale) && pdfViewer.currentScale > 0 ? pdfViewer.currentScale : DEFAULT_ZOOM
    )
    focusContainer()
  }, [focusContainer])

  useEffect(() => {
    const pdfViewer = pdfViewerRef.current
    if (pdfViewer) {
      pdfViewer.pageColors = {
        ...(background ? { background } : {}),
        foreground: PDF_PAGE_FOREGROUND
      }
    }
    applyViewerBackground(background)
  }, [applyViewerBackground, background])

  useEffect(() => {
    updateBackground()

    const target = document.documentElement
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateBackground)
    observer?.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })

    return () => observer?.disconnect()
  }, [updateBackground])

  useEffect(() => {
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null

    setDocumentProxy(null)
    setStatus('loading')
    setCurrentPage(0)
    setPageCount(0)
    setZoom(DEFAULT_ZOOM)

    void (async () => {
      try {
        // Preflight the size via metadata (a stat, not a read) so oversized PDFs are
        // rejected before we read + IPC-transfer the whole file into pdf.js.
        const metadata = await window.api.file.getMetadata(createFilePathHandle(filePath))
        if (cancelled) return
        if (metadata.size > PDF_PREVIEW_MAX_SIZE_BYTES) {
          setStatus('too_large')
          return
        }

        const pdfData = toUint8Array(await window.api.fs.read(filePath))
        if (cancelled) return

        loadingTask = getDocument({ data: pdfData })
        const nextDocument = await loadingTask.promise
        if (cancelled) return

        setDocumentProxy(nextDocument)
      } catch (error) {
        if (cancelled) return
        if (loadingTask) {
          destroyLoadingTask(loadingTask, filePath)
          loadingTask = null
        }
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to load PDF preview: ${filePath}`, normalized)
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      if (loadingTask) {
        destroyLoadingTask(loadingTask, filePath)
        loadingTask = null
      }
    }
  }, [filePath, refreshKey])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerRef.current
    if (!documentProxy || !container || !viewerElement) return

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewerAbortController = new AbortController()
    let pdfViewer: PdfJsViewer

    try {
      const viewerOptions: PdfViewerOptionsWithAbortSignal = {
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        abortSignal: viewerAbortController.signal,
        annotationMode: AnnotationMode.ENABLE,
        pageColors: {
          ...(backgroundRef.current ? { background: backgroundRef.current } : {}),
          foreground: PDF_PAGE_FOREGROUND
        },
        supportsPinchToZoom: true
      }
      pdfViewer = new PDFViewer(viewerOptions)
    } catch (error) {
      viewerAbortController.abort()
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error(`Failed to initialize PDF preview: ${filePath}`, normalized)
      setStatus('error')
      return
    }

    const syncBackground = () => applyViewerBackground(backgroundRef.current)
    const syncPreviewControls = () => {
      const nextPageCount = documentProxy.numPages
      setPageCount(nextPageCount)
      setCurrentPage(nextPageCount > 0 ? clamp(pdfViewer.currentPageNumber || 1, 1, nextPageCount) : 0)

      if (Number.isFinite(pdfViewer.currentScale) && pdfViewer.currentScale > 0) {
        setZoom(pdfViewer.currentScale)
      }
    }
    const handlePagesInit = () => {
      syncBackground()
      syncPreviewControls()
    }
    const handlePageChanging = (event?: PdfPageChangingEvent) => {
      const nextPageCount = documentProxy.numPages
      const nextPage = event?.pageNumber ?? pdfViewer.currentPageNumber
      setPageCount(nextPageCount)
      setCurrentPage(nextPageCount > 0 ? clamp(nextPage, 1, nextPageCount) : 0)
    }
    const handleScaleChanging = (event?: PdfScaleChangingEvent) => {
      const nextScale = event?.scale ?? pdfViewer.currentScale
      if (typeof nextScale === 'number' && Number.isFinite(nextScale) && nextScale > 0) {
        setZoom(nextScale)
      }
    }
    const zoomOptions = { drawingDelay: ZOOM_DRAWING_DELAY }
    let pinchWheelDelta = 0
    let pinchWheelResetTimer: number | null = null
    let pinchWheelAnimationFrame: number | null = null
    let pinchWheelOrigin: [number, number] = [0, 0]
    const clearPinchWheelResetTimer = () => {
      if (pinchWheelResetTimer === null) return
      window.clearTimeout(pinchWheelResetTimer)
      pinchWheelResetTimer = null
    }
    const resetPinchWheelDelta = () => {
      pinchWheelDelta = 0
      clearPinchWheelResetTimer()
    }
    const schedulePinchWheelReset = () => {
      clearPinchWheelResetTimer()
      pinchWheelResetTimer = window.setTimeout(resetPinchWheelDelta, PINCH_WHEEL_IDLE_RESET_MS)
    }
    const schedulePinchWheelAnimationFrame = () => {
      if (pinchWheelAnimationFrame !== null) return

      pinchWheelAnimationFrame = window.requestAnimationFrame(() => {
        pinchWheelAnimationFrame = null
        if (Math.abs(pinchWheelDelta) < PINCH_WHEEL_MIN_DELTA) return

        const scaleFactor = clamp(Math.exp(-pinchWheelDelta * PINCH_SCALE_SENSITIVITY), 0.94, 1.06)
        const origin = pinchWheelOrigin
        resetPinchWheelDelta()
        pdfViewer.updateScale({ origin, scaleFactor })
      })
    }
    const clearPinchWheelTimers = () => {
      resetPinchWheelDelta()
      if (pinchWheelAnimationFrame === null) return
      window.cancelAnimationFrame(pinchWheelAnimationFrame)
      pinchWheelAnimationFrame = null
    }
    const handleWheelZoom = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return

      event.preventDefault()
      pinchWheelDelta += normalizePinchWheelDelta(event)
      pinchWheelOrigin = [event.clientX, event.clientY]
      schedulePinchWheelReset()
      schedulePinchWheelAnimationFrame()
    }
    const handleKeyboardZoom = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        pdfViewer.increaseScale(zoomOptions)
        handleScaleChanging()
        return
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        pdfViewer.decreaseScale(zoomOptions)
        handleScaleChanging()
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
        handleScaleChanging()
      }
    }

    try {
      pdfViewerRef.current = pdfViewer
      linkService.setViewer(pdfViewer)
      pdfViewer.setDocument(documentProxy)
      linkService.setDocument(documentProxy)
      syncPreviewControls()
      void pdfViewer.firstPagePromise
        .then(() => {
          if (pdfViewerRef.current !== pdfViewer) return
          pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
          syncBackground()
          syncPreviewControls()
          setStatus('ready')
        })
        .catch((error: unknown) => {
          if (pdfViewerRef.current !== pdfViewer) return
          const normalized = error instanceof Error ? error : new Error(String(error))
          logger.error(`Failed to initialize PDF preview: ${filePath}`, normalized)
          setStatus('error')
          setDocumentProxy(null)
        })

      eventBus.on('pagesinit', handlePagesInit)
      eventBus.on('pagerendered', syncBackground)
      eventBus.on('pagechanging', handlePageChanging)
      eventBus.on('scalechanging', handleScaleChanging)
      container.addEventListener('wheel', handleWheelZoom, { passive: false })
      container.addEventListener('keydown', handleKeyboardZoom)
      container.addEventListener('pointerdown', focusContainer)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error(`Failed to initialize PDF preview: ${filePath}`, normalized)
      setStatus('error')
      setDocumentProxy(null)
    }

    return () => {
      viewerAbortController.abort()
      eventBus.off('pagesinit', handlePagesInit)
      eventBus.off('pagerendered', syncBackground)
      eventBus.off('pagechanging', handlePageChanging)
      eventBus.off('scalechanging', handleScaleChanging)
      container.removeEventListener('wheel', handleWheelZoom)
      container.removeEventListener('keydown', handleKeyboardZoom)
      container.removeEventListener('pointerdown', focusContainer)
      clearPinchWheelTimers()
      detachDocument(pdfViewer)
      pdfViewer.cleanup()
      if (pdfViewerRef.current === pdfViewer) {
        pdfViewerRef.current = null
      }
    }
  }, [applyViewerBackground, documentProxy, filePath, focusContainer])

  const hasPages = status === 'ready' && pageCount > 0

  return (
    <FilePreviewLayout.Frame>
      <PdfFilePreviewToolbar
        currentPage={hasPages ? currentPage : 0}
        pageCount={hasPages ? pageCount : 0}
        zoomLabel={formatZoom(zoom)}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        onZoomOut={() => zoomBy('out')}
        onZoomIn={() => zoomBy('in')}
        onResetZoom={resetZoom}
      />
      <FilePreviewLayout.Content>
        <div
          ref={rootRef}
          data-testid="pdf-file-preview"
          className="relative h-full min-h-0 w-full overflow-hidden bg-background">
          {status === 'error' ? (
            <div role="alert" className="h-full">
              <EmptyState
                icon={AlertCircle}
                title={t('file_preview.load_error.title')}
                description={t('file_preview.load_error.description')}
                className="h-full"
              />
            </div>
          ) : status === 'too_large' ? (
            <PdfPreviewTooLarge filePath={filePath} />
          ) : (
            <>
              <div
                ref={containerRef}
                data-testid="pdfjs-viewer-container"
                role="region"
                aria-label={fileName}
                className="absolute inset-0 overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                tabIndex={0}>
                <div ref={viewerRef} data-testid="pdfjs-viewer" className="pdfViewer" />
              </div>
              {status === 'loading' ? (
                <div
                  role="status"
                  className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-sm">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  <span>{t('file_preview.loading')}</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
