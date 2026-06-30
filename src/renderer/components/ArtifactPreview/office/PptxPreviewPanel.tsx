import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DocumentPreviewToolbar from '../DocumentPreviewToolbar'

const logger = loggerService.withContext('PptxPreviewPanel')

const PPTX_PREVIEW_DEFAULT_ZOOM = 100
const PPTX_PREVIEW_ZOOM_STEP = 10
const PPTX_PREVIEW_MIN_ZOOM = 50
const PPTX_PREVIEW_MAX_ZOOM = 200
const PPTX_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024

interface PptxPreviewPanelProps {
  filePath: string
  fileName: string
  refreshKey: number
  sourceSize?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const toPptxData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data as Uint8Array
}

const formatPptxZoom = (zoom: number): string => `${Math.round(zoom)}%`

const PptxPreviewPanel = ({ filePath, fileName, refreshKey, sourceSize }: PptxPreviewPanelProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewer | null>(null)
  const controlsBusyRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(PPTX_PREVIEW_DEFAULT_ZOOM)
  const [controlsBusy, setControlsBusy] = useState(false)

  const setPreviewControlsBusy = useCallback((busy: boolean) => {
    controlsBusyRef.current = busy
    setControlsBusy(busy)
  }, [])

  const focusContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      const viewer = viewerRef.current
      if (!viewer || pageCount <= 0 || controlsBusyRef.current) return

      const nextPage = clamp(pageNumber, 1, pageCount)
      setPreviewControlsBusy(true)
      void viewer
        .goToSlide(nextPage - 1, { block: 'center' })
        .then(() => {
          if (viewerRef.current !== viewer) return
          setCurrentPage(viewer.currentSlideIndex + 1)
        })
        .catch((navigationError: unknown) => {
          logger.warn('Failed to navigate PPTX preview slide', {
            filePath,
            error: navigationError instanceof Error ? navigationError.message : String(navigationError)
          })
        })
        .finally(() => {
          if (viewerRef.current !== viewer) return
          setPreviewControlsBusy(false)
          focusContainer()
        })
    },
    [filePath, focusContainer, pageCount, setPreviewControlsBusy]
  )

  const setViewerZoom = useCallback(
    (nextZoom: number) => {
      const viewer = viewerRef.current
      if (!viewer || controlsBusyRef.current) return

      const clampedZoom = clamp(nextZoom, PPTX_PREVIEW_MIN_ZOOM, PPTX_PREVIEW_MAX_ZOOM)
      setPreviewControlsBusy(true)
      void viewer
        .setZoom(clampedZoom)
        .then(() => {
          if (viewerRef.current !== viewer) return
          setZoom(viewer.zoomPercent)
        })
        .catch((zoomError: unknown) => {
          logger.warn('Failed to update PPTX preview zoom', {
            filePath,
            error: zoomError instanceof Error ? zoomError.message : String(zoomError)
          })
        })
        .finally(() => {
          if (viewerRef.current !== viewer) return
          setPreviewControlsBusy(false)
          focusContainer()
        })
    },
    [filePath, focusContainer, setPreviewControlsBusy]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const controller = new AbortController()
    let cancelled = false
    let viewer: PptxViewer | null = null

    setError(null)
    setLoading(true)
    setCurrentPage(0)
    setPageCount(0)
    setZoom(PPTX_PREVIEW_DEFAULT_ZOOM)
    setPreviewControlsBusy(false)
    container.innerHTML = ''

    void (async () => {
      try {
        if (typeof sourceSize === 'number' && sourceSize > PPTX_PREVIEW_MAX_SOURCE_BYTES) {
          throw new Error('PPTX preview supports files up to 25 MB')
        }

        const pptxData = toPptxData(await window.api.fs.read(filePath))
        if (cancelled) return

        viewer = new PptxViewer(container, {
          fitMode: 'contain',
          zoomPercent: PPTX_PREVIEW_DEFAULT_ZOOM,
          scrollContainer: container,
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          lazyMedia: true,
          lazySlides: true,
          pdfjs: false,
          onSlideChange: (index) => {
            if (!cancelled) setCurrentPage(index + 1)
          },
          onRenderStart: () => {
            if (!cancelled) setPreviewControlsBusy(true)
          },
          onRenderComplete: () => {
            if (cancelled) return
            const activeViewer = viewerRef.current
            if (activeViewer) setZoom(activeViewer.zoomPercent)
            setPreviewControlsBusy(false)
          },
          onSlideError: (index, slideError) => {
            logger.warn('Failed to render PPTX preview slide', {
              filePath,
              slide: index + 1,
              error: slideError instanceof Error ? slideError.message : String(slideError)
            })
          },
          onNodeError: (nodeId, nodeError) => {
            logger.warn('Failed to render PPTX preview node', {
              filePath,
              nodeId,
              error: nodeError instanceof Error ? nodeError.message : String(nodeError)
            })
          }
        })
        viewerRef.current = viewer

        await viewer.open(pptxData, {
          renderMode: 'list',
          listOptions: {
            windowed: true,
            batchSize: 4,
            initialSlides: 3,
            overscanViewport: 2
          },
          signal: controller.signal,
          lazyMedia: true,
          lazySlides: true
        })
        if (cancelled) return

        const nextPageCount = viewer.slideCount
        setPageCount(nextPageCount)
        setCurrentPage(nextPageCount > 0 ? viewer.currentSlideIndex + 1 : 0)
        focusContainer()
      } catch (loadError) {
        if (cancelled) return
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        logger.error(`Failed to load PPTX: ${filePath}`, normalized)
        setError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      controlsBusyRef.current = false
      if (viewerRef.current === viewer) {
        viewerRef.current = null
      }
      viewer?.destroy()
      container.innerHTML = ''
    }
  }, [filePath, focusContainer, refreshKey, setPreviewControlsBusy, sourceSize])

  if (error) {
    return <EmptyState icon={AlertCircle} title={t('common.error')} description={t('files.preview.error')} />
  }

  const canUsePreviewControls = pageCount > 0

  return (
    <div
      data-testid="pptx-preview-panel"
      aria-label={fileName}
      className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {canUsePreviewControls && (
        <div className="flex shrink-0 justify-end border-border-subtle border-b bg-background px-3 py-2">
          <DocumentPreviewToolbar
            currentPage={currentPage}
            pageCount={pageCount}
            zoomLabel={formatPptxZoom(zoom)}
            pageIndicatorTestId="pptx-preview-page-indicator"
            zoomIndicatorTestId="pptx-preview-zoom-value"
            className="static shadow-sm"
            canPreviousPage={!controlsBusy && currentPage > 1}
            canNextPage={!controlsBusy && currentPage < pageCount}
            canZoomOut={!controlsBusy && zoom > PPTX_PREVIEW_MIN_ZOOM}
            canZoomIn={!controlsBusy && zoom < PPTX_PREVIEW_MAX_ZOOM}
            canResetZoom={!controlsBusy && zoom !== PPTX_PREVIEW_DEFAULT_ZOOM}
            onPreviousPage={() => jumpToPage(currentPage - 1)}
            onNextPage={() => jumpToPage(currentPage + 1)}
            onZoomOut={() => setViewerZoom(zoom - PPTX_PREVIEW_ZOOM_STEP)}
            onZoomIn={() => setViewerZoom(zoom + PPTX_PREVIEW_ZOOM_STEP)}
            onResetZoom={() => setViewerZoom(PPTX_PREVIEW_DEFAULT_ZOOM)}
          />
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span className="size-4 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
            <span>{t('common.loading')}</span>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="pptx-viewer-container"
        className="min-h-0 flex-1 overflow-auto bg-background px-6 py-5 outline-none"
        tabIndex={0}
      />
    </div>
  )
}

export default PptxPreviewPanel
