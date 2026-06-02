import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { renderAsync } from 'docx-preview'
import type { TFunction } from 'i18next'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WordPreviewPanel')
const WORD_PREVIEW_DEFAULT_ZOOM = 1
const WORD_PREVIEW_MIN_ZOOM = 0.5
const WORD_PREVIEW_MAX_ZOOM = 2
const WORD_PREVIEW_ZOOM_STEP = 0.1

export interface WordPreviewPanelProps {
  fileName?: string
  filePath: string
  refreshKey?: number
}

type WordPreviewStatus =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'error'; code: 'parse_failed' | 'read_failed'; detail?: string }

const WORD_PREVIEW_ERROR_KEYS: Record<Extract<WordPreviewStatus, { type: 'error' }>['code'], string> = {
  parse_failed: 'agent.preview_pane.word.errors.parse_failed',
  read_failed: 'agent.preview_pane.word.errors.read_failed'
}

const getWordPreviewErrorDescription = (
  t: TFunction,
  code: Extract<WordPreviewStatus, { type: 'error' }>['code'],
  detail?: string
): string => {
  return t(WORD_PREVIEW_ERROR_KEYS[code], { defaultValue: detail ?? t('common.error') })
}

const toWordData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data as Uint8Array
}

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const clampZoom = (value: number) => Number(clampNumber(value, WORD_PREVIEW_MIN_ZOOM, WORD_PREVIEW_MAX_ZOOM).toFixed(2))

const getWordPages = (bodyContainer: HTMLElement | null): HTMLElement[] =>
  Array.from(bodyContainer?.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx') ?? [])

const WordPreviewPanel = ({ filePath, fileName, refreshKey = 0 }: WordPreviewPanelProps) => {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLElement[]>([])
  const scrollFrameRef = useRef<number | null>(null)
  const [status, setStatus] = useState<WordPreviewStatus>({ type: 'loading' })
  const [zoom, setZoom] = useState(WORD_PREVIEW_DEFAULT_ZOOM)
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)

  const setCurrentPageIfChanged = useCallback((nextPage: number) => {
    setCurrentPage((current) => (current === nextPage ? current : nextPage))
  }, [])

  const cancelPendingScrollSync = useCallback(() => {
    if (scrollFrameRef.current === null) return

    window.cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = null
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setZoom((current) => clampZoom(current + delta))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(WORD_PREVIEW_DEFAULT_ZOOM)
  }, [])

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      const pages = pagesRef.current
      if (!pages.length) return

      const nextPage = clampNumber(pageNumber, 1, pages.length)
      setCurrentPageIfChanged(nextPage)
      pages[nextPage - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [setCurrentPageIfChanged]
  )

  const syncCurrentPageFromScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null

      const scrollContainer = scrollContainerRef.current
      const pages = pagesRef.current
      if (!scrollContainer || !pages.length) return

      const containerTop = scrollContainer.getBoundingClientRect().top
      let activeIndex = 0

      for (let index = 0; index < pages.length; index += 1) {
        const distance = pages[index].getBoundingClientRect().top - containerTop
        if (distance <= 40) {
          activeIndex = index
        }
      }

      setCurrentPageIfChanged(activeIndex + 1)
    })
  }, [setCurrentPageIfChanged])

  useEffect(() => {
    return () => {
      cancelPendingScrollSync()
    }
  }, [cancelPendingScrollSync])

  useEffect(() => {
    let cancelled = false
    const scrollContainer = scrollContainerRef.current
    const bodyContainer = bodyRef.current
    const styleContainer = styleRef.current

    if (!bodyContainer || !styleContainer) return

    cancelPendingScrollSync()
    pagesRef.current = []
    bodyContainer.replaceChildren()
    styleContainer.replaceChildren()
    setStatus({ type: 'loading' })
    setCurrentPageIfChanged(0)
    setPageCount(0)
    scrollContainer?.scrollTo?.({ top: 0, left: 0 })

    void (async () => {
      try {
        const data = toWordData(await window.api.fs.read(filePath))
        if (cancelled) return

        try {
          await renderAsync(data, bodyContainer, styleContainer, {
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            inWrapper: true,
            renderAltChunks: false,
            renderComments: false,
            renderEndnotes: true,
            renderFooters: true,
            renderFootnotes: true,
            renderHeaders: true,
            useBase64URL: true
          })
        } catch (renderError) {
          if (cancelled) return

          const normalized = renderError instanceof Error ? renderError : new Error(String(renderError))
          logger.error(`Failed to render Word preview: ${filePath}`, normalized)
          bodyContainer.replaceChildren()
          styleContainer.replaceChildren()
          setStatus({ type: 'error', code: 'parse_failed', detail: normalized.message })
          return
        }

        if (cancelled) {
          bodyContainer.replaceChildren()
          styleContainer.replaceChildren()
          return
        }

        const pages = getWordPages(bodyContainer)
        pagesRef.current = pages
        setPageCount(pages.length)
        setCurrentPageIfChanged(pages.length ? 1 : 0)
        setStatus({ type: 'ready' })
      } catch (err) {
        if (cancelled) return

        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to load Word preview: ${filePath}`, normalized)
        pagesRef.current = []
        bodyContainer.replaceChildren()
        styleContainer.replaceChildren()
        setStatus({ type: 'error', code: 'read_failed', detail: normalized.message })
      }
    })()

    return () => {
      cancelled = true
      cancelPendingScrollSync()
      pagesRef.current = []
      bodyContainer.replaceChildren()
      styleContainer.replaceChildren()
    }
  }, [cancelPendingScrollSync, filePath, refreshKey, setCurrentPageIfChanged])

  const canUsePageControls = status.type === 'ready' && pageCount > 0
  const zoomLabel = `${Math.round(zoom * 100)}%`
  const bodyStyle = { '--word-preview-zoom': zoom } as CSSProperties

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/30 text-neutral-950 dark:bg-neutral-100">
      {canUsePageControls && (
        <div
          className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-lg border border-border-subtle bg-popover p-1 text-popover-foreground shadow-md"
          role="toolbar"
          aria-label={t('agent.preview_pane.preview')}>
          <Tooltip content={t('common.previous')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('common.previous')}
              disabled={currentPage <= 1}
              onClick={() => jumpToPage(currentPage - 1)}>
              <ChevronLeft size={14} />
            </Button>
          </Tooltip>
          <span
            className="min-w-12 px-1 text-center text-muted-foreground text-xs tabular-nums"
            data-testid="word-preview-page-indicator">
            {currentPage} / {pageCount}
          </span>
          <Tooltip content={t('common.next')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('common.next')}
              disabled={currentPage >= pageCount}
              onClick={() => jumpToPage(currentPage + 1)}>
              <ChevronRight size={14} />
            </Button>
          </Tooltip>
          <span className="mx-1 h-4 w-px bg-border-subtle" />
          <Tooltip content={t('preview.zoom_out')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('preview.zoom_out')}
              disabled={zoom <= WORD_PREVIEW_MIN_ZOOM}
              onClick={() => zoomBy(-WORD_PREVIEW_ZOOM_STEP)}>
              <ZoomOut size={14} />
            </Button>
          </Tooltip>
          <span className="min-w-10 px-1 text-center text-muted-foreground text-xs tabular-nums">{zoomLabel}</span>
          <Tooltip content={t('preview.zoom_in')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('preview.zoom_in')}
              disabled={zoom >= WORD_PREVIEW_MAX_ZOOM}
              onClick={() => zoomBy(WORD_PREVIEW_ZOOM_STEP)}>
              <ZoomIn size={14} />
            </Button>
          </Tooltip>
          <Tooltip content={t('preview.reset')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('preview.reset')}
              onClick={resetZoom}>
              <RotateCcw size={14} />
            </Button>
          </Tooltip>
        </div>
      )}

      <div ref={scrollContainerRef} className="h-full w-full overflow-auto" onScroll={syncCurrentPageFromScroll}>
        <div
          aria-label={fileName ?? filePath}
          className="[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 mx-auto flex min-h-full w-full min-w-fit justify-center px-2 py-4 [&_.docx-wrapper>section.docx]:mb-4 [&_.docx-wrapper>section.docx]:border [&_.docx-wrapper>section.docx]:border-neutral-200 [&_.docx-wrapper>section.docx]:bg-white [&_.docx-wrapper>section.docx]:shadow-sm"
          data-testid="word-preview-document">
          <div ref={styleRef} data-testid="word-preview-styles" />
          <div
            ref={bodyRef}
            className="[zoom:var(--word-preview-zoom)]"
            data-testid="word-preview-body"
            style={bodyStyle}
          />
        </div>
      </div>

      {status.type === 'loading' && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-muted/30 dark:bg-neutral-100">
          <LoadingState label={t('common.loading')} />
        </div>
      )}

      {status.type === 'error' && (
        <div className="absolute inset-0 h-full w-full bg-muted/30 dark:bg-neutral-100">
          <EmptyState
            icon={AlertCircle}
            title={t('common.error')}
            description={getWordPreviewErrorDescription(t, status.code, status.detail)}
          />
        </div>
      )}
    </div>
  )
}

export default WordPreviewPanel
