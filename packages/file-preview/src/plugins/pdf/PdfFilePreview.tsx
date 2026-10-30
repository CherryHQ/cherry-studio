import './pdfViewer.css'
import { AlertCircle, FileWarning, LoaderCircle } from 'lucide-react'
import { AnnotationMode, getDocument, PDFWorker, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist'
import { EventBus, PDFLinkService, type PDFPageView, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle, EmptyState } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { usePreviewHost, usePreviewLogger } from '../../previewContext'
import { resolveResourceBase } from '../../resources'
import { createPreviewSelection } from '../../selection'
import { PreviewError } from '../../source'
import { attachTouchPinch } from '../../touchPinch'
import type { FilePreviewPluginProps } from '../../types'
import { PdfFilePreviewToolbar } from './PdfFilePreviewToolbar'
import { PDF_RANGE_CHUNK_SIZE_BYTES, PdfFileRangeTransport, PdfRangeTooLargeError } from './PdfFileRangeTransport'
import { createPdfResourceFactories } from './pdfjsResourceFactories'
import { type PdfDestination, PdfOutline, type PdfOutlineItem, type PdfOutlineStatus } from './PdfOutline'
import { pageToPdfAnchor } from './pdfSelectionAnchor'

const DEFAULT_PDF_SCALE = 'page-width'
const DEFAULT_ZOOM = 1
const ZOOM_DRAWING_DELAY = 400
const PINCH_WHEEL_MIN_DELTA = 0.08
const PINCH_WHEEL_MAX_EVENT_DELTA = 0.8
const PINCH_WHEEL_PIXEL_DIVISOR = 10
const PINCH_WHEEL_IDLE_RESET_MS = 180
const PINCH_SCALE_SENSITIVITY = 0.075
// PDFViewer in pdf.js 5.4.296 clamps to these bounds but does not export them.
const PDF_MIN_SCALE = 0.1
const PDF_MAX_SCALE = 10

type PdfJsViewer = InstanceType<typeof PDFViewer>
type PdfJsLinkService = InstanceType<typeof PDFLinkService>
type PdfViewerOptionsWithAbortSignal = ConstructorParameters<typeof PDFViewer>[0] & { abortSignal: AbortSignal }

interface PdfPageChangingEvent {
  pageNumber?: number
}

interface PdfScaleChangingEvent {
  scale?: number
}

interface PdfViewAreaEvent {
  location: { pageNumber: number; left: number; top: number }
}

function isEffectiveBackground(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized && normalized !== 'transparent' && normalized !== 'rgba(0, 0, 0, 0)')
}

function resolveThemeBackground(element: HTMLElement | null): string | null {
  const candidates = [element, document.documentElement].filter(Boolean) as HTMLElement[]

  for (const candidate of candidates) {
    const value = getComputedStyle(candidate).getPropertyValue('--background').trim()
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

function PdfPreviewTooLarge() {
  const { t } = useTranslation()

  const { onRequestOpen } = usePreviewHost()

  return (
    <div role="alert" className="h-full">
      <EmptyState
        icon={FileWarning}
        title={t('file_preview.pdf.too_large.title')}
        description={t('file_preview.pdf.too_large.description')}
        actionLabel={onRequestOpen ? t('file_preview.too_large.action') : undefined}
        onAction={onRequestOpen ? () => onRequestOpen('too_large') : undefined}
        className="h-full"
      />
    </div>
  )
}

/**
 * PDF preview with page-level selection picking. The anchor names a page and the excerpt comes from
 * the pdf.js document proxy rather than the DOM: text-layer order is not reading order, and a page's
 * text layer may not be rendered yet. The pick lives in React state and the DOM marker is derived
 * from it, because pdf.js rebuilds the page elements it renders and a DOM-only truth would be wiped
 * along with them. `preventDefault` on a click covers external `href` annotations only — pdf.js binds
 * an internal destination with `link.onclick`, which runs first and jumps instead of picking (known
 * limitation, see the FilePreview README).
 */
export default function PdfFilePreview({
  sourceId,
  fileName,
  document: previewDocument,
  onSelection
}: FilePreviewPluginProps) {
  const logger = usePreviewLogger('PdfFilePreview')
  const { root: previewRoot, resources, options, failDocument, isCurrentDocument } = usePreviewHost()
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PdfJsViewer | null>(null)
  const restoredViewerRef = useRef<PdfJsViewer | null>(null)
  const linkServiceRef = useRef<PdfJsLinkService | null>(null)
  // Restoring a numeric scale keeps the view unchanged; retain the preset separately for later resizes.
  const zoomIntentRef = useRef({ value: DEFAULT_PDF_SCALE, width: 0 })
  const readingPositionRef = useRef<{
    scale: number
    page: number
    top: number
    left: number
    viewBox: number[]
  } | null>(null)
  const captureReadingPosition = useCallback(() => {
    const viewer = pdfViewerRef.current
    const container = containerRef.current
    if (!viewer || restoredViewerRef.current !== viewer || !container || container.clientHeight === 0) return
    // Recompute PDF.js's first-visible-page anchor before teardown, including a scroll in this frame.
    viewer.update()
  }, [])
  // Activity disconnects layout effects before hiding the DOM; passive cleanup sees a zero-sized viewport.
  useLayoutEffect(() => captureReadingPosition, [captureReadingPosition])
  const [background, setBackground] = useState(() => resolveThemeBackground(null))
  const backgroundRef = useRef(background)
  backgroundRef.current = background
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null)
  const [status, setStatus] = useState<'error' | 'loading' | 'ready' | 'too_large'>('loading')
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [isOutlineOpen, setIsOutlineOpen] = useState(false)
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([])
  const [outlineStatus, setOutlineStatus] = useState<PdfOutlineStatus>('loading')
  const [pickedPage, setPickedPage] = useState<number | null>(null)
  const outlineLayout = options?.pdf?.outlineLayout ?? 'panel'
  const responsiveLayout = options?.pdf?.outlineLayout !== undefined
  const outlineTriggerRef = useRef<HTMLElement | null>(null)
  const outlineNavigatedRef = useRef(false)

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

  // The token guards against a slow text fetch reporting a stale pick: a new pick empties the host
  // while that page's text is in flight, so the chip can never quote the page the marker just left.
  const pickTokenRef = useRef(0)
  const handlePick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onSelection || !(event.target instanceof Element)) return
      if (event.target.closest('a[href]')) event.preventDefault()

      const resolved = pageToPdfAnchor(event.target)
      const token = ++pickTokenRef.current
      if (!resolved || resolved.page === pickedPage || !documentProxy) {
        setPickedPage(null)
        onSelection(null)
        return
      }

      setPickedPage(resolved.page)
      onSelection(null)
      void documentProxy
        .getPage(resolved.page)
        .then(async (page) => {
          const content = await page.getTextContent()
          if (token !== pickTokenRef.current) return
          const excerpt = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
          const reference = createPreviewSelection({
            sourceId,
            anchor: { format: 'pdf', page: resolved.page },
            excerpt,
            revision: previewDocument.revision
          })
          // A page with no text at all: drop the marker the click put on, so no page stays outlined
          // as picked while the host holds nothing.
          if (!reference) setPickedPage(null)
          onSelection(reference)
        })
        .catch((error: unknown) => {
          if (token !== pickTokenRef.current) return
          setPickedPage(null)
          logger.warn(`Failed to read PDF page text for a pick: ${sourceId}`, error)
          onSelection(null)
        })
    },
    [documentProxy, sourceId, previewDocument, onSelection, pickedPage, logger]
  )

  // Sole owner of the marker: pdf.js rebuilds the viewer's page divs, so a childList mutation (or a
  // `zoom` change, which re-renders in place) repaints it. A rebuild is not a pick — report nothing.
  useEffect(() => {
    const viewerElement = viewerRef.current
    if (!viewerElement) return

    const applyMarker = () => {
      viewerElement.querySelectorAll('[data-pdf-picked]').forEach((marked) => marked.removeAttribute('data-pdf-picked'))
      if (pickedPage === null) return
      viewerElement.querySelector(`.page[data-page-number="${pickedPage}"]`)?.setAttribute('data-pdf-picked', 'true')
    }

    applyMarker()
    const observer = new MutationObserver(applyMarker)
    observer.observe(viewerElement, { childList: true })
    return () => observer.disconnect()
  }, [pickedPage, zoom])

  useEffect(() => {
    if (onSelection) return
    pickTokenRef.current += 1
    setPickedPage(null)
  }, [onSelection])

  // A different document — or the same one reloaded — carries no pick; the host drops its reference
  // on refresh too.
  useEffect(() => {
    pickTokenRef.current += 1
    setPickedPage(null)
  }, [sourceId, previewDocument])

  // An in-flight page-text fetch must not reach the host after the preview is gone.
  useEffect(
    () => () => {
      pickTokenRef.current += 1
    },
    []
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

  const navigateToOutlineDestination = useCallback(
    (destination: PdfDestination) => {
      const linkService = linkServiceRef.current
      if (!linkService) return

      if (outlineLayout === 'overlay') {
        outlineNavigatedRef.current = true
        setIsOutlineOpen(false)
      }

      void linkService.goToDestination(destination).catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to navigate PDF outline: ${sourceId}`, normalized, 'navigation_error')
      })
    },
    [sourceId, logger, outlineLayout]
  )

  useEffect(() => {
    const container = containerRef.current
    const viewer = pdfViewerRef.current
    if (!responsiveLayout || status !== 'ready' || !container || !viewer) return

    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth
      if (nextWidth <= 0 || nextWidth === zoomIntentRef.current.width) return
      zoomIntentRef.current.width = nextWidth
      if (zoomIntentRef.current.value === DEFAULT_PDF_SCALE) {
        viewer.currentScaleValue = DEFAULT_PDF_SCALE
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [responsiveLayout, status, documentProxy])

  useEffect(() => {
    const pdfViewer = pdfViewerRef.current
    if (pdfViewer) {
      pdfViewer.pageColors = background ? { background } : null
    }
    applyViewerBackground(background)
  }, [applyViewerBackground, background])

  useEffect(() => {
    updateBackground()

    const target = document.documentElement
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(updateBackground)
    observer?.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    // Hosts may theme the preview root itself (a `dark` class or token overrides) instead of the page.
    if (previewRoot) observer?.observe(previewRoot, { attributes: true, attributeFilter: ['class', 'style'] })

    return () => observer?.disconnect()
  }, [previewRoot, updateBackground])

  useEffect(() => {
    let cancelled = false
    let failed = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    let rangeTransport: PdfFileRangeTransport | null = null
    let workerPort: Worker | null = null
    let worker: PDFWorker | null = null
    let disposing = false
    const isCurrent = () => !cancelled && isCurrentDocument?.() !== false

    const dispose = () => {
      if (disposing) return
      disposing = true
      // Both a closed range and normal replacement can destroy the viewer before React cleanup.
      captureReadingPosition()
      rangeTransport?.abort()
      const task = loadingTask
      loadingTask = null
      void (async () => {
        try {
          // pdf.js needs a live worker to acknowledge termination before clearing its fonts.
          await task?.destroy()
        } catch (error) {
          logger.error(`Failed to destroy PDF loading task: ${sourceId}`, error)
        } finally {
          worker?.destroy()
          workerPort?.terminate()
        }
      })()
    }

    const failLoad = (error: unknown) => {
      if (cancelled || failed) return
      if (!isCurrent()) {
        dispose()
        return
      }
      failed = true
      dispose()
      const normalized = error instanceof Error ? error : new Error(String(error))
      failDocument?.(
        normalized instanceof PdfRangeTooLargeError
          ? new PreviewError('too_large', normalized.message, { cause: normalized })
          : normalized
      )
      if (normalized instanceof PdfRangeTooLargeError) {
        setDocumentProxy(null)
        setStatus('too_large')
        return
      }
      setDocumentProxy(null)
      setStatus('error')
    }

    setDocumentProxy(null)
    setStatus('loading')
    setCurrentPage(0)
    setPageCount(0)
    setOutlineItems([])
    setOutlineStatus('loading')

    void (async () => {
      try {
        if (cancelled) return
        const resourceBase = resources?.readPdfResource ? null : resolveResourceBase(resources?.baseUrl)
        workerPort = resources?.createWorker
          ? resources.createWorker('pdf')
          : resources?.baseUrl
            ? new Worker(new URL('pdf.worker.js', new URL(resources.baseUrl, document.baseURI)), { type: 'module' })
            : new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })
        worker = PDFWorker.create({ port: workerPort })
        rangeTransport = new PdfFileRangeTransport(previewDocument, failLoad)
        loadingTask = getDocument({
          worker,
          range: rangeTransport,
          rangeChunkSize: PDF_RANGE_CHUNK_SIZE_BYTES,
          disableAutoFetch: true,
          disableStream: true,
          cMapPacked: true,
          ...(resourceBase
            ? {
                cMapUrl: new URL('cmaps/', resourceBase).href,
                standardFontDataUrl: new URL('standard_fonts/', resourceBase).href
              }
            : {}),
          useWorkerFetch: !resources?.readPdfResource,
          ...(resources?.readPdfResource ? createPdfResourceFactories(resources.readPdfResource) : {})
        })
        const nextDocument = await loadingTask.promise
        if (!isCurrent() || failed) {
          dispose()
          return
        }

        setDocumentProxy(nextDocument)
      } catch (error) {
        failLoad(error)
      }
    })()

    return () => {
      cancelled = true
      dispose()
    }
  }, [sourceId, previewDocument, resources, failDocument, logger, captureReadingPosition, isCurrentDocument])

  useEffect(() => {
    if (!documentProxy || documentProxy.loadingTask.destroyed) return

    let cancelled = false
    setOutlineItems([])
    setOutlineStatus('loading')

    void documentProxy
      .getOutline()
      .then((items) => {
        if (cancelled || isCurrentDocument?.() === false) return
        setOutlineItems(items ?? [])
        setOutlineStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled || isCurrentDocument?.() === false) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to load PDF outline: ${sourceId}`, normalized)
        setOutlineStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [documentProxy, sourceId, logger, isCurrentDocument])

  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerRef.current
    if (!documentProxy || documentProxy.loadingTask.destroyed || !container || !viewerElement) return

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewerAbortController = new AbortController()
    let pdfViewer: PdfJsViewer
    const isCurrent = () => pdfViewerRef.current === pdfViewer && isCurrentDocument?.() !== false

    try {
      const viewerOptions: PdfViewerOptionsWithAbortSignal = {
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        abortSignal: viewerAbortController.signal,
        annotationMode: AnnotationMode.ENABLE,
        ...(backgroundRef.current ? { pageColors: { background: backgroundRef.current } } : {}),
        supportsPinchToZoom: true
      }
      pdfViewer = new PDFViewer(viewerOptions)
    } catch (error) {
      viewerAbortController.abort()
      const normalized = error instanceof Error ? error : new Error(String(error))
      failDocument?.(normalized)
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
        if (restoredViewerRef.current === pdfViewer) {
          zoomIntentRef.current = { value: pdfViewer.currentScaleValue, width: container.clientWidth }
        }
        setZoom(nextScale)
      }
    }
    const handleViewArea = (event: PdfViewAreaEvent) => {
      if (restoredViewerRef.current !== pdfViewer || container.clientHeight === 0) return
      const { pageNumber, left, top } = event.location
      const pageView = pdfViewer.getPageView(pageNumber - 1)
      if (!pageView?.pdfPage) return
      readingPositionRef.current = {
        scale: pdfViewer.currentScale,
        page: pageNumber,
        left,
        top,
        viewBox: [...pageView.viewport.viewBox]
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
    const scaleOrigin = ([clientX, clientY]: [number, number]): [number, number] => {
      const rect = container.getBoundingClientRect()
      return [clientX - rect.left + container.offsetLeft, clientY - rect.top + container.offsetTop]
    }
    const handleWheelZoom = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return

      event.preventDefault()
      pinchWheelDelta += normalizePinchWheelDelta(event)
      pinchWheelOrigin = scaleOrigin([event.clientX, event.clientY])
      schedulePinchWheelReset()
      schedulePinchWheelAnimationFrame()
    }
    let touchPinchFactor = 1
    let touchPinchOrigin: [number, number] = [0, 0]
    let touchPinchFrame: number | null = null
    const applyTouchPinch = () => {
      touchPinchFrame = null
      const targetScale = clamp(pdfViewer.currentScale * touchPinchFactor, PDF_MIN_SCALE, PDF_MAX_SCALE)
      pdfViewer.updateScale({
        ...zoomOptions,
        origin: touchPinchOrigin,
        scaleFactor: targetScale / pdfViewer.currentScale
      })
      touchPinchFactor = targetScale / pdfViewer.currentScale
    }
    const endTouchPinch = () => {
      if (touchPinchFrame !== null) {
        window.cancelAnimationFrame(touchPinchFrame)
        applyTouchPinch()
      }
      touchPinchFactor = 1
    }
    // Coalesce a gesture's steps per frame; drawingDelay CSS-scales pages until the fingers settle.
    const detachTouchPinch = attachTouchPinch(
      container,
      (scaleFactor, origin) => {
        touchPinchFactor *= scaleFactor
        touchPinchOrigin = scaleOrigin(origin)
        if (touchPinchFrame === null) touchPinchFrame = window.requestAnimationFrame(applyTouchPinch)
      },
      endTouchPinch
    )
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
      linkServiceRef.current = linkService
      linkService.setViewer(pdfViewer)
      pdfViewer.setDocument(documentProxy)
      linkService.setDocument(documentProxy)
      syncPreviewControls()
      void pdfViewer.firstPagePromise
        .then(async () => {
          if (!isCurrent()) return
          const position = readingPositionRef.current
          if (position) {
            const pageNumber = clamp(position.page, 1, documentProxy.numPages)
            const ensurePageGeometry = async (number: number): Promise<PDFPageView | null> => {
              const view: PDFPageView = pdfViewer.getPageView(number - 1)
              if (!view.pdfPage) {
                const page = await documentProxy.getPage(number)
                if (!isCurrent()) return null
                if (!view.pdfPage) view.setPdfPage(page)
              }
              return view
            }
            const pageView = await ensurePageGeometry(pageNumber)
            if (!pageView || !isCurrent()) return
            pdfViewer.currentPageNumber = pageNumber
            pdfViewer.currentScaleValue = String(position.scale)
            const point =
              pageNumber === position.page
                ? [position.left, position.top].map((value, axis) => {
                    const min = pageView.viewport.viewBox[axis]
                    const max = pageView.viewport.viewBox[axis + 2]
                    // Preserve native page margins; constrain formerly in-page points to the new bounds.
                    if (value < position.viewBox[axis]) return min + value - position.viewBox[axis]
                    if (value > position.viewBox[axis + 2]) return max + value - position.viewBox[axis + 2]
                    return clamp(value, min, max)
                  })
                : null
            // Unloaded views inherit page 1's size. Resolve the reading area before scrolling so
            // a short placeholder after the anchor cannot clamp the destination above that anchor.
            const offsetTop = point ? pageView.viewport.convertToViewportPoint(point[0], point[1])[1] : 0
            let remainingHeight = container.clientHeight + offsetTop - pageView.height
            for (let number = pageNumber + 1; remainingHeight > 0 && number <= documentProxy.numPages; number++) {
              const nextPage = await ensurePageGeometry(number)
              if (!nextPage || !isCurrent()) return
              remainingHeight -= nextPage.height
            }
            // At the document end, the clamped viewport also includes pages before the anchor.
            remainingHeight -= Math.max(0, offsetTop)
            for (let number = pageNumber - 1; remainingHeight > 0 && number >= 1; number--) {
              const previousPage = await ensurePageGeometry(number)
              if (!previousPage || !isCurrent()) return
              remainingHeight -= previousPage.height
            }
            pdfViewer.scrollPageIntoView({
              pageNumber,
              destArray: [null, { name: 'XYZ' }, point?.[0] ?? null, point?.[1] ?? null, null],
              allowNegativeOffset: true,
              ignoreDestinationZoom: true
            })
          } else {
            zoomIntentRef.current = { value: DEFAULT_PDF_SCALE, width: container.clientWidth }
            pdfViewer.currentScaleValue = DEFAULT_PDF_SCALE
          }
          syncBackground()
          syncPreviewControls()
          restoredViewerRef.current = pdfViewer
          setStatus('ready')
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return
          const normalized = error instanceof Error ? error : new Error(String(error))
          failDocument?.(normalized)
          setStatus('error')
          setDocumentProxy(null)
        })

      eventBus.on('pagesinit', handlePagesInit)
      eventBus.on('pagerendered', syncBackground)
      eventBus.on('pagechanging', handlePageChanging)
      eventBus.on('scalechanging', handleScaleChanging)
      eventBus.on('updateviewarea', handleViewArea)
      container.addEventListener('wheel', handleWheelZoom, { passive: false })
      container.addEventListener('keydown', handleKeyboardZoom)
      container.addEventListener('pointerdown', focusContainer)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      failDocument?.(normalized)
      setStatus('error')
      setDocumentProxy(null)
    }

    return () => {
      viewerAbortController.abort()
      eventBus.off('pagesinit', handlePagesInit)
      eventBus.off('pagerendered', syncBackground)
      eventBus.off('pagechanging', handlePageChanging)
      eventBus.off('scalechanging', handleScaleChanging)
      eventBus.off('updateviewarea', handleViewArea)
      container.removeEventListener('wheel', handleWheelZoom)
      container.removeEventListener('keydown', handleKeyboardZoom)
      container.removeEventListener('pointerdown', focusContainer)
      clearPinchWheelTimers()
      detachTouchPinch()
      if (touchPinchFrame !== null) window.cancelAnimationFrame(touchPinchFrame)
      detachDocument(pdfViewer)
      pdfViewer.cleanup()
      if (pdfViewerRef.current === pdfViewer) {
        pdfViewerRef.current = null
      }
      if (restoredViewerRef.current === pdfViewer) restoredViewerRef.current = null
      if (linkServiceRef.current === linkService) {
        linkServiceRef.current = null
      }
    }
  }, [applyViewerBackground, documentProxy, sourceId, focusContainer, logger, failDocument, isCurrentDocument])

  const hasPages = status === 'ready' && pageCount > 0

  return (
    <FilePreviewLayout.Frame>
      <PdfFilePreviewToolbar
        currentPage={hasPages ? currentPage : 0}
        isOutlineOpen={isOutlineOpen}
        pageCount={hasPages ? pageCount : 0}
        zoomLabel={formatZoom(zoom)}
        onJumpToPage={jumpToPage}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        onZoomOut={() => zoomBy('out')}
        onZoomIn={() => zoomBy('in')}
        onResetZoom={resetZoom}
        onToggleOutline={() => {
          outlineTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          outlineNavigatedRef.current = false
          setIsOutlineOpen((open) => !open)
        }}
      />
      <FilePreviewLayout.Content scrollsInternally>
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
            <PdfPreviewTooLarge />
          ) : (
            <>
              <div className="flex h-full min-h-0 w-full">
                {isOutlineOpen && outlineLayout === 'panel' ? (
                  <PdfOutline items={outlineItems} status={outlineStatus} onNavigate={navigateToOutlineDestination} />
                ) : null}
                <div className="relative min-w-0 flex-1">
                  <div
                    ref={containerRef}
                    data-testid="pdfjs-viewer-container"
                    style={
                      options?.bottomInset === 'content'
                        ? { paddingBottom: 'var(--file-preview-bottom-inset, 0px)' }
                        : undefined
                    }
                    data-picker={onSelection ? 'true' : undefined}
                    role="region"
                    aria-label={fileName}
                    className="absolute inset-0 touch-pan-x touch-pan-y overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [&[data-picker=true]_.page:not([data-pdf-picked=true]):hover]:outline [&[data-picker=true]_.page:not([data-pdf-picked=true]):hover]:outline-2 [&[data-picker=true]_.page:not([data-pdf-picked=true]):hover]:outline-primary/40 [&[data-picker=true]_.page]:cursor-pointer [&_.page[data-pdf-picked=true]]:outline [&_.page[data-pdf-picked=true]]:outline-2 [&_.page[data-pdf-picked=true]]:outline-primary"
                    tabIndex={0}
                    onClick={handlePick}>
                    <div ref={viewerRef} data-testid="pdfjs-viewer" className="pdfViewer selectable" />
                  </div>
                </div>
              </div>
              {status === 'loading' ? (
                <div
                  role="status"
                  className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 bg-background text-sm">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  <span>{t('file_preview.loading')}</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </FilePreviewLayout.Content>
      {outlineLayout === 'overlay' ? (
        <Dialog open={isOutlineOpen} onOpenChange={setIsOutlineOpen}>
          <DialogContent
            aria-describedby={undefined}
            closeLabel={t('common.close')}
            motion="fade-scale"
            overlayClassName="absolute"
            className="absolute top-0 left-0 h-full w-64 max-w-[calc(100%-2rem)] translate-x-0 translate-y-0 gap-0 rounded-none p-0 sm:max-w-64"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (outlineNavigatedRef.current) focusContainer()
              else outlineTriggerRef.current?.focus({ preventScroll: true })
            }}>
            <DialogTitle className="sr-only">{t('file_preview.pdf.outline.title')}</DialogTitle>
            <PdfOutline
              className="w-full border-r-0"
              items={outlineItems}
              status={outlineStatus}
              onNavigate={navigateToOutlineDestination}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </FilePreviewLayout.Frame>
  )
}
