import type { PresentationData } from '@aiden0z/pptx-renderer'
import { buildPresentation, parseZipLazyMedia, PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { createFilePathHandle } from '@shared/utils/file'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { PowerPointFilePreviewToolbar } from './PowerPointFilePreviewToolbar'

const logger = loggerService.withContext('PowerPointFilePreview')

const PPTX_PREVIEW_DEFAULT_ZOOM = 100
const PPTX_PREVIEW_ZOOM_STEP = 10
const PPTX_PREVIEW_MIN_ZOOM = 50
const PPTX_PREVIEW_MAX_ZOOM = 200
const PPTX_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024
const EXTERNAL_TARGET_MODE = 'external'
const EXTERNAL_MEDIA_RELATIONSHIP_TYPES = new Set(['image', 'audio', 'video', 'media'])

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const formatPptxZoom = (zoom: number): string => `${Math.round(zoom)}%`

function toUint8Array(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer

  if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer
  }

  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function assertSourceSize(size: number): void {
  if (size > PPTX_PREVIEW_MAX_SOURCE_BYTES) {
    throw new Error('PPTX preview supports files up to 25 MB')
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Preview aborted', 'AbortError')
  }
}

function getRelationshipTypeName(type: string): string {
  return type.trim().toLowerCase().split('/').at(-1) ?? ''
}

function stripExternalMediaRelationshipMap(rels: Map<string, { type: string; targetMode?: string }>): void {
  for (const [id, rel] of rels) {
    if (
      rel.targetMode?.trim().toLowerCase() === EXTERNAL_TARGET_MODE &&
      EXTERNAL_MEDIA_RELATIONSHIP_TYPES.has(getRelationshipTypeName(rel.type))
    ) {
      rels.delete(id)
    }
  }
}

function stripExternalMediaRelationships(presentation: PresentationData): void {
  for (const slide of presentation.slides) {
    stripExternalMediaRelationshipMap(slide.rels)
  }

  for (const layout of presentation.layouts.values()) {
    stripExternalMediaRelationshipMap(layout.rels)
  }

  for (const master of presentation.masters.values()) {
    stripExternalMediaRelationshipMap(master.rels)
  }
}

export default function PowerPointFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
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
        // Preflight the size via metadata (a stat, not a read) so oversized files
        // are rejected before we allocate + IPC-transfer the whole presentation.
        const metadata = await window.api.file.getMetadata(createFilePathHandle(filePath))
        if (cancelled) return
        assertSourceSize(metadata.size)

        const pptxData = toUint8Array(await window.api.fs.read(filePath))
        assertSourceSize(pptxData.byteLength)
        if (cancelled) return

        throwIfAborted(controller.signal)
        const pptxFiles = await parseZipLazyMedia(toArrayBuffer(pptxData), RECOMMENDED_ZIP_LIMITS)
        throwIfAborted(controller.signal)
        const presentation = buildPresentation(pptxFiles, { lazySlides: true })
        stripExternalMediaRelationships(presentation)
        throwIfAborted(controller.signal)

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

        viewer.load(presentation)
        await viewer.renderList({
          windowed: true,
          batchSize: 4,
          initialSlides: 3,
          overscanViewport: 2
        })
        throwIfAborted(controller.signal)
        if (cancelled) return

        const nextPageCount = viewer.slideCount
        setPageCount(nextPageCount)
        setCurrentPage(nextPageCount > 0 ? viewer.currentSlideIndex + 1 : 0)
        focusContainer()
      } catch (loadError) {
        if (cancelled) return
        if (viewerRef.current === viewer) {
          viewerRef.current = null
        }
        viewer?.destroy()
        container.innerHTML = ''
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        logger.error(`Failed to load PPTX preview: ${filePath}`, normalized)
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
  }, [filePath, focusContainer, refreshKey, setPreviewControlsBusy])

  const hasPages = !error && pageCount > 0

  return (
    <FilePreviewLayout.Frame>
      <PowerPointFilePreviewToolbar
        currentPage={hasPages ? currentPage : 0}
        pageCount={hasPages ? pageCount : 0}
        zoomLabel={formatPptxZoom(zoom)}
        canPreviousPage={hasPages && !controlsBusy && currentPage > 1}
        canNextPage={hasPages && !controlsBusy && currentPage < pageCount}
        canZoomOut={hasPages && !controlsBusy && zoom > PPTX_PREVIEW_MIN_ZOOM}
        canZoomIn={hasPages && !controlsBusy && zoom < PPTX_PREVIEW_MAX_ZOOM}
        canResetZoom={hasPages && !controlsBusy && zoom !== PPTX_PREVIEW_DEFAULT_ZOOM}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        onZoomOut={() => setViewerZoom(zoom - PPTX_PREVIEW_ZOOM_STEP)}
        onZoomIn={() => setViewerZoom(zoom + PPTX_PREVIEW_ZOOM_STEP)}
        onResetZoom={() => setViewerZoom(PPTX_PREVIEW_DEFAULT_ZOOM)}
      />
      <FilePreviewLayout.Content>
        <div
          data-testid="powerpoint-file-preview"
          className="relative h-full min-h-0 w-full overflow-hidden bg-background">
          <div
            ref={containerRef}
            data-testid="pptx-viewer-container"
            role="region"
            aria-label={fileName}
            className="absolute inset-0 overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            tabIndex={0}
          />
          {loading ? (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="absolute inset-0 bg-background">
              <EmptyState
                icon={AlertCircle}
                title={t('file_preview.load_error.title')}
                description={t('file_preview.load_error.description')}
                className="h-full"
              />
            </div>
          ) : null}
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
