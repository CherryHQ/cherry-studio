import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { renderAsync } from 'docx-preview'
import { AlertCircle } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DocumentPreviewToolbar from '../DocumentPreviewToolbar'

const logger = loggerService.withContext('WordPreviewPanel')

const DOCX_PREVIEW_DEFAULT_ZOOM = 1
const DOCX_PREVIEW_ZOOM_STEP = 0.1
const DOCX_PREVIEW_MIN_ZOOM = 0.5
const DOCX_PREVIEW_MAX_ZOOM = 2
const DOCX_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024

interface WordPreviewPanelProps {
  filePath: string
  fileName: string
  refreshKey: number
  sourceSize?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const formatDocxZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`

const toDocxData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data as Uint8Array
}

function assertSourceSize(size: number): void {
  if (size > DOCX_PREVIEW_MAX_SOURCE_BYTES) {
    throw new Error('DOCX preview supports files up to 25 MB')
  }
}

function getRenderedPages(body: HTMLElement): HTMLElement[] {
  const sections = Array.from(body.querySelectorAll<HTMLElement>('section'))
  if (sections.length > 0) return sections
  return Array.from(body.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

const WordPreviewPanel = ({ filePath, fileName, refreshKey, sourceSize }: WordPreviewPanelProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(DOCX_PREVIEW_DEFAULT_ZOOM)

  const focusContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      if (pageCount <= 0) return

      const nextPage = clamp(pageNumber, 1, pageCount)
      setCurrentPage(nextPage)
      bodyRef.current
        ?.querySelector<HTMLElement>(`#docx-preview-page-${nextPage}`)
        ?.scrollIntoView?.({ block: 'start' })
      focusContainer()
    },
    [focusContainer, pageCount]
  )

  const zoomBy = useCallback(
    (direction: 'in' | 'out') => {
      setZoom((value) =>
        clamp(
          Number((value + (direction === 'in' ? DOCX_PREVIEW_ZOOM_STEP : -DOCX_PREVIEW_ZOOM_STEP)).toFixed(2)),
          DOCX_PREVIEW_MIN_ZOOM,
          DOCX_PREVIEW_MAX_ZOOM
        )
      )
      focusContainer()
    },
    [focusContainer]
  )

  const resetZoom = useCallback(() => {
    setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)
    focusContainer()
  }, [focusContainer])

  useEffect(() => {
    const bodyContainer = bodyRef.current
    const styleContainer = styleRef.current
    if (!bodyContainer || !styleContainer) return

    let cancelled = false
    setError(null)
    setLoading(true)
    setCurrentPage(0)
    setPageCount(0)
    setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)
    bodyContainer.innerHTML = ''
    styleContainer.innerHTML = ''

    void (async () => {
      try {
        if (typeof sourceSize === 'number') assertSourceSize(sourceSize)

        const docxData = toDocxData(await window.api.fs.read(filePath))
        assertSourceSize(docxData.byteLength)
        if (cancelled) return

        await renderAsync(docxData, bodyContainer, styleContainer, {
          className: 'docx-preview',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
          renderAltChunks: false
        })
        if (cancelled) {
          bodyContainer.innerHTML = ''
          styleContainer.innerHTML = ''
          return
        }

        const pages = getRenderedPages(bodyContainer)
        pages.forEach((page, index) => {
          page.id = `docx-preview-page-${index + 1}`
          page.dataset.docxPreviewPage = String(index + 1)
          page.classList.add('docx-preview-page')
        })
        const nextPageCount = Math.max(pages.length, 1)
        setPageCount(nextPageCount)
        setCurrentPage(nextPageCount > 0 ? 1 : 0)
        focusContainer()
      } catch (loadError) {
        if (cancelled) return
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        logger.error(`Failed to load DOCX: ${filePath}`, normalized)
        setError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      bodyContainer.innerHTML = ''
      styleContainer.innerHTML = ''
    }
  }, [filePath, focusContainer, refreshKey, sourceSize])

  if (error) {
    return <EmptyState icon={AlertCircle} title={t('common.error')} description={t('files.preview.error')} />
  }

  const canUsePreviewControls = pageCount > 0
  const contentStyle = { zoom } as CSSProperties

  return (
    <div
      data-testid="docx-preview-panel"
      aria-label={fileName}
      className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {canUsePreviewControls && (
        <div className="flex shrink-0 justify-end border-border-subtle border-b bg-background px-3 py-2">
          <DocumentPreviewToolbar
            currentPage={currentPage}
            pageCount={pageCount}
            zoomLabel={formatDocxZoom(zoom)}
            pageIndicatorTestId="docx-preview-page-indicator"
            zoomIndicatorTestId="docx-preview-zoom-value"
            className="static shadow-sm"
            canPreviousPage={currentPage > 1}
            canNextPage={currentPage < pageCount}
            canZoomOut={zoom > DOCX_PREVIEW_MIN_ZOOM}
            canZoomIn={zoom < DOCX_PREVIEW_MAX_ZOOM}
            canResetZoom={zoom !== DOCX_PREVIEW_DEFAULT_ZOOM}
            onPreviousPage={() => jumpToPage(currentPage - 1)}
            onNextPage={() => jumpToPage(currentPage + 1)}
            onZoomOut={() => zoomBy('out')}
            onZoomIn={() => zoomBy('in')}
            onResetZoom={resetZoom}
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
        className="min-h-0 flex-1 overflow-auto bg-background px-6 py-5 outline-none"
        tabIndex={0}>
        <div ref={styleRef} />
        <div
          ref={bodyRef}
          data-testid="docx-preview-content"
          data-zoom={zoom}
          style={contentStyle}
          className="mx-auto w-fit min-w-0 [&_.docx-preview-wrapper]:mx-auto [&_.docx-preview]:box-border [&_.docx-preview]:max-w-full [&_section]:overflow-hidden [&_section]:rounded-sm [&_section]:shadow-md"
        />
      </div>
    </div>
  )
}

export default WordPreviewPanel
