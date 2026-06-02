import 'pdfjs-dist/web/pdf_viewer.css'

import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { AlertCircle } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist'
// oxlint-disable-next-line import/default -- Vite exposes ?url imports as default asset URLs.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const logger = loggerService.withContext('PdfPreviewPanel')
const DEFAULT_PDF_SCALE = 'page-width'
const PDF_ZOOM_DRAWING_DELAY = 400
const PDF_PINCH_WHEEL_MIN_DELTA = 0.08
const PDF_PINCH_WHEEL_MAX_EVENT_DELTA = 0.8
const PDF_PINCH_WHEEL_PIXEL_DIVISOR = 10
const PDF_PINCH_WHEEL_IDLE_RESET_MS = 180
const PDF_PINCH_SCALE_SENSITIVITY = 0.075
const PDF_PAGE_FOREGROUND = 'CanvasText'

type PdfJsViewer = InstanceType<typeof PDFViewer>

interface PdfPreviewPanelProps {
  filePath: string
  fileName: string
  refreshKey: number
}

const isEffectiveBackground = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized && normalized !== 'transparent' && normalized !== 'rgba(0, 0, 0, 0)')
}

const resolveThemeBackground = (element: HTMLElement | null): string | null => {
  const candidates = [element, window.root, document.documentElement].filter(Boolean) as HTMLElement[]

  for (const candidate of candidates) {
    const value = getComputedStyle(candidate).getPropertyValue('--color-background').trim()
    if (value) return value
  }

  const backgroundColor = getComputedStyle(document.documentElement).backgroundColor
  return isEffectiveBackground(backgroundColor) ? backgroundColor : null
}

const toPdfData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data as Uint8Array
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const normalizePinchWheelDelta = (event: WheelEvent): number => {
  const divisor =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 30
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 1
        : PDF_PINCH_WHEEL_PIXEL_DIVISOR

  return clamp(event.deltaY / divisor, -PDF_PINCH_WHEEL_MAX_EVENT_DELTA, PDF_PINCH_WHEEL_MAX_EVENT_DELTA)
}

const detachDocument = (viewer: PdfJsViewer) => {
  ;(viewer.setDocument as (pdfDocument: PDFDocumentProxy | null) => void)(null)
}

const PdfPreviewPanel = ({ filePath, fileName, refreshKey }: PdfPreviewPanelProps) => {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PdfJsViewer | null>(null)
  const [background, setBackground] = useState(() => resolveThemeBackground(null))
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)

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
    let loadedDocument: PDFDocumentProxy | null = null

    setDocumentProxy(null)
    setError(null)
    setLoading(true)

    void (async () => {
      try {
        const data = toPdfData(await window.api.fs.read(filePath))
        if (cancelled) return

        loadingTask = getDocument({ data })
        const nextDocument = await loadingTask.promise
        if (cancelled) {
          void nextDocument.destroy()
          return
        }

        loadedDocument = nextDocument
        setDocumentProxy(nextDocument)
      } catch (loadError) {
        if (cancelled) return
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        logger.error(`Failed to load PDF: ${filePath}`, normalized)
        setError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
      void loadedDocument?.destroy()
    }
  }, [filePath, refreshKey])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerRef.current
    if (!documentProxy || !container || !viewerElement) return

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const pdfViewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      pageColors: {
        ...(background ? { background } : {}),
        foreground: PDF_PAGE_FOREGROUND
      },
      supportsPinchToZoom: true
    })

    const syncBackground = () => applyViewerBackground(background)
    const focusContainer = () => container.focus({ preventScroll: true })
    const zoomOptions = { drawingDelay: PDF_ZOOM_DRAWING_DELAY }
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
      pinchWheelResetTimer = window.setTimeout(resetPinchWheelDelta, PDF_PINCH_WHEEL_IDLE_RESET_MS)
    }
    const schedulePinchWheelAnimationFrame = () => {
      if (pinchWheelAnimationFrame !== null) return

      pinchWheelAnimationFrame = window.requestAnimationFrame(() => {
        pinchWheelAnimationFrame = null
        if (Math.abs(pinchWheelDelta) < PDF_PINCH_WHEEL_MIN_DELTA) return

        const scaleFactor = clamp(Math.exp(-pinchWheelDelta * PDF_PINCH_SCALE_SENSITIVITY), 0.94, 1.06)
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
      if (!event.ctrlKey && !event.metaKey) return
      if (event.deltaY === 0) return

      event.preventDefault()

      pinchWheelDelta += normalizePinchWheelDelta(event)
      const rect = container.getBoundingClientRect()
      pinchWheelOrigin = [event.clientX - rect.left, event.clientY - rect.top]

      schedulePinchWheelReset()
      schedulePinchWheelAnimationFrame()
    }
    const handleKeyboardZoom = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        pdfViewer.increaseScale(zoomOptions)
        return
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        pdfViewer.decreaseScale(zoomOptions)
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
      }
    }

    try {
      pdfViewerRef.current = pdfViewer
      linkService.setViewer(pdfViewer)
      pdfViewer.setDocument(documentProxy)
      linkService.setDocument(documentProxy)
      pdfViewer.firstPagePromise
        .then(() => {
          if (pdfViewerRef.current !== pdfViewer) return
          pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
          focusContainer()
          syncBackground()
        })
        .catch((viewerError: unknown) => {
          if (pdfViewerRef.current !== pdfViewer) return
          const normalized = viewerError instanceof Error ? viewerError : new Error(String(viewerError))
          logger.error('Failed to initialize PDF viewer', normalized)
          setError(normalized)
        })

      eventBus.on('pagesinit', syncBackground)
      eventBus.on('pagerendered', syncBackground)
      container.addEventListener('wheel', handleWheelZoom, { passive: false })
      container.addEventListener('keydown', handleKeyboardZoom)
      container.addEventListener('pointerdown', focusContainer)
    } catch (viewerError) {
      const normalized = viewerError instanceof Error ? viewerError : new Error(String(viewerError))
      logger.error('Failed to initialize PDF viewer', normalized)
      setError(normalized)
    }

    return () => {
      eventBus.off('pagesinit', syncBackground)
      eventBus.off('pagerendered', syncBackground)
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
  }, [applyViewerBackground, background, documentProxy])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <LoadingState label={t('common.loading')} />
      </div>
    )
  }

  if (error) {
    return <EmptyState icon={AlertCircle} title={t('common.error')} description={error.message} />
  }

  if (!documentProxy) return null

  return (
    <div
      ref={rootRef}
      data-testid="pdf-preview-panel"
      aria-label={fileName}
      className="relative h-full w-full overflow-hidden bg-background">
      <div
        ref={containerRef}
        data-testid="pdfjs-viewer-container"
        className="absolute inset-0 overflow-auto bg-background outline-none"
        style={{ inset: '0', position: 'absolute' }}
        tabIndex={0}>
        <div ref={viewerRef} data-testid="pdfjs-viewer" className="pdfViewer" />
      </div>
    </div>
  )
}

export default PdfPreviewPanel
