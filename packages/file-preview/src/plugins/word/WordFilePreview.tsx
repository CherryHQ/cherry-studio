import { renderAsync } from 'docx-preview'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import { FilePreviewTooLarge } from '../../FilePreviewTooLarge'
import { assertZipLimits } from '../../officeZipPreflight'
import { usePreviewHost } from '../../previewContext'
import { createPreviewSelection } from '../../selection'
import { PreviewError, readPreviewDocument } from '../../source'
import { attachTouchPinch } from '../../touchPinch'
import type { FilePreviewPluginProps } from '../../types'
import { paragraphToDocxAnchor } from './docxSelectionAnchor'
import { WordFilePreviewToolbar } from './WordFilePreviewToolbar'

const DOCX_PREVIEW_DEFAULT_ZOOM = 1
const DOCX_PREVIEW_ZOOM_STEP = 0.1
const DOCX_PREVIEW_MIN_ZOOM = 0.5
const DOCX_PREVIEW_MAX_ZOOM = 2
const DOCX_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024
const SAFE_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const formatDocxZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`

function getRenderedPages(body: HTMLElement): HTMLElement[] {
  const sections = Array.from(body.querySelectorAll<HTMLElement>('section'))
  if (sections.length > 0) return sections
  return Array.from(body.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
}

function sanitizeHyperlinks(body: HTMLElement): void {
  body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? ''
    let protocol: string | null = null

    try {
      protocol = new URL(href, 'https://docx-preview.invalid/').protocol
    } catch {
      protocol = null
    }

    if (!protocol || !SAFE_HYPERLINK_PROTOCOLS.has(protocol)) {
      anchor.removeAttribute('href')
    }
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
}

export default function WordFilePreview({
  sourceId,
  fileName,
  document: previewDocument,
  onSelection
}: FilePreviewPluginProps) {
  const { options, failDocument } = usePreviewHost()
  const { t } = useTranslation()
  const docxClassName = `docx-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const renderTokenRef = useRef(0)
  const fitScrollTopRef = useRef<number | null>(null)
  const committedZoomRef = useRef(DOCX_PREVIEW_DEFAULT_ZOOM)
  const pinchAnchorRef = useRef<{
    zoom: number
    x: number
    y: number
    origin: [number, number]
  } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(DOCX_PREVIEW_DEFAULT_ZOOM)
  const [fitZoom, setFitZoom] = useState(DOCX_PREVIEW_DEFAULT_ZOOM)
  const [manualZoom, setManualZoom] = useState(false)
  const [normalizeSymbolBullets] = useState(() => options?.docx?.normalizeSymbolBullets === true)
  const fitWidth = options?.docx?.initialZoom === 'fit-width'
  const minZoom = fitWidth ? Math.min(DOCX_PREVIEW_MIN_ZOOM, fitZoom) : DOCX_PREVIEW_MIN_ZOOM

  useLayoutEffect(() => {
    committedZoomRef.current = zoom
    const anchor = pinchAnchorRef.current
    pinchAnchorRef.current = null
    const container = containerRef.current
    const body = bodyRef.current
    if (!anchor || !container || !body) return
    const rect = body.getBoundingClientRect()
    container.scrollLeft += rect.left + anchor.x * zoom - anchor.origin[0]
    container.scrollTop += rect.top + anchor.y * zoom - anchor.origin[1]
  }, [zoom])

  useLayoutEffect(() => {
    const container = containerRef.current
    const body = bodyRef.current
    if (!fitWidth || !container || !body || pageCount <= 0) return

    const fit = () => {
      const width = body.offsetWidth
      if (container.clientWidth > 0 && width > 0) {
        setFitZoom(Math.min(DOCX_PREVIEW_DEFAULT_ZOOM, container.clientWidth / width))
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    observer.observe(body)
    return () => observer.disconnect()
  }, [fitWidth, pageCount])

  useLayoutEffect(() => {
    if (!fitWidth || manualZoom) return
    const container = containerRef.current
    if (zoom === fitZoom) {
      if (container && fitScrollTopRef.current !== null) container.scrollTop = fitScrollTopRef.current
      fitScrollTopRef.current = null
      return
    }
    if (container) fitScrollTopRef.current = container.scrollTop * (fitZoom / zoom)
    setZoom(fitZoom)
  }, [fitWidth, fitZoom, manualZoom, zoom])

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
      setManualZoom(true)
      setZoom((value) =>
        clamp(
          Number((value + (direction === 'in' ? DOCX_PREVIEW_ZOOM_STEP : -DOCX_PREVIEW_ZOOM_STEP)).toFixed(2)),
          minZoom,
          DOCX_PREVIEW_MAX_ZOOM
        )
      )
      focusContainer()
    },
    [focusContainer, minZoom]
  )

  const resetZoom = useCallback(() => {
    setManualZoom(false)
    if (!fitWidth) setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)
    focusContainer()
  }, [focusContainer, fitWidth])

  useEffect(() => {
    const bodyContainer = bodyRef.current
    const styleContainer = styleRef.current
    if (!bodyContainer || !styleContainer) return

    const controller = new AbortController()
    const token = ++renderTokenRef.current
    const isCurrent = () => renderTokenRef.current === token
    setError(null)
    setLoading(true)
    setCurrentPage(0)
    setPageCount(0)
    setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)
    setFitZoom(DOCX_PREVIEW_DEFAULT_ZOOM)
    setManualZoom(false)
    fitScrollTopRef.current = null
    pinchAnchorRef.current = null

    const stagingHost = document.createElement('div')
    const stagingBody = document.createElement('div')
    const stagingStyle = document.createElement('div')
    stagingHost.style.cssText = 'position:fixed;top:0;left:-99999px;visibility:hidden;'
    stagingHost.append(stagingStyle, stagingBody)
    document.body.appendChild(stagingHost)

    void (async () => {
      try {
        const docxData = await readPreviewDocument(previewDocument, DOCX_PREVIEW_MAX_SOURCE_BYTES, controller.signal)
        if (!isCurrent()) return

        assertZipLimits(docxData, 'DOCX')
        if (!isCurrent()) return

        await renderAsync(docxData, stagingBody, stagingStyle, {
          className: docxClassName,
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
          renderAltChunks: false,
          normalizeSymbolBullets
        })
        if (!isCurrent()) return

        stagingBody.querySelector(`.${docxClassName}-wrapper`)?.classList.add('docx-preview-wrapper')
        const pages = getRenderedPages(stagingBody)
        pages.forEach((page, index) => {
          page.id = `docx-preview-page-${index + 1}`
          page.dataset.docxPreviewPage = String(index + 1)
          page.classList.add('docx-preview-page', 'docx-preview')
        })
        sanitizeHyperlinks(stagingBody)
        bodyContainer.replaceChildren(...stagingBody.childNodes)
        styleContainer.replaceChildren(...stagingStyle.childNodes)

        const nextPageCount = Math.max(pages.length, 1)
        setPageCount(nextPageCount)
        setCurrentPage(nextPageCount > 0 ? 1 : 0)
        focusContainer()
      } catch (loadError) {
        if (!isCurrent()) return
        const normalized = loadError instanceof Error ? loadError : new Error(String(loadError))
        failDocument?.(normalized)
        setError(normalized)
      } finally {
        if (isCurrent()) setLoading(false)
        stagingHost.remove()
      }
    })()

    return () => {
      controller.abort()
      renderTokenRef.current += 1
      bodyContainer.innerHTML = ''
      styleContainer.innerHTML = ''
      stagingHost.remove()
    }
  }, [sourceId, focusContainer, previewDocument, failDocument, docxClassName, normalizeSymbolBullets])

  useEffect(() => {
    const scrollRoot = containerRef.current
    const bodyContainer = bodyRef.current
    if (!scrollRoot || !bodyContainer || pageCount <= 0) return

    const pages = Array.from(bodyContainer.querySelectorAll<HTMLElement>('.docx-preview-page'))
    if (pages.length === 0) return

    const visiblePages = new Set<HTMLElement>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = entry.target as HTMLElement
          if (entry.isIntersecting) {
            visiblePages.add(page)
          } else {
            visiblePages.delete(page)
          }
        }
        const topmost = pages.find((page) => visiblePages.has(page))
        const pageNumber = topmost ? Number(topmost.dataset.docxPreviewPage) : null
        if (pageNumber && Number.isFinite(pageNumber)) setCurrentPage(pageNumber)
      },
      { root: scrollRoot, threshold: [0, 0.5, 1] }
    )

    pages.forEach((page) => observer.observe(page))
    return () => observer.disconnect()
  }, [pageCount])

  // The marker goes on only after createPreviewSelection confirms the host receives something: an empty
  // paragraph must not look picked while the host gets null.
  const handlePick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onSelection || !(event.target instanceof Element)) return
      if (event.target.closest('a[href]')) event.preventDefault()
      const bodyContainer = bodyRef.current
      const previous = bodyContainer?.querySelector<HTMLElement>('[data-docx-picked="true"]') ?? null
      const resolved = paragraphToDocxAnchor(event.target)
      previous?.removeAttribute('data-docx-picked')

      // Clicking the picked paragraph again clears the pick; anything else replaces it.
      if (!resolved || resolved.element === previous) {
        onSelection(null)
        return
      }
      const reference = createPreviewSelection({
        sourceId,
        anchor: resolved.anchor,
        excerpt: resolved.excerpt,
        revision: previewDocument.revision
      })
      if (reference) resolved.element.setAttribute('data-docx-picked', 'true')
      onSelection(reference)
    },
    [sourceId, previewDocument, onSelection]
  )

  // A pick outlives nothing: when the host stops capturing, the marker goes with it.
  useEffect(() => {
    if (onSelection) return
    bodyRef.current?.querySelector<HTMLElement>('[data-docx-picked="true"]')?.removeAttribute('data-docx-picked')
  }, [onSelection])

  // Pinch steps are tiny, so they compound unrounded; rounding each one would stall a slow pinch.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return attachTouchPinch(container, (scaleFactor, origin) => {
      const body = bodyRef.current
      if (!body) return
      const currentZoom = committedZoomRef.current
      const nextZoom = clamp(
        (pinchAnchorRef.current?.zoom ?? currentZoom) * scaleFactor,
        minZoom,
        DOCX_PREVIEW_MAX_ZOOM
      )
      const rect = body.getBoundingClientRect()
      pinchAnchorRef.current =
        nextZoom === currentZoom
          ? null
          : {
              zoom: nextZoom,
              x: (origin[0] - rect.left) / currentZoom,
              y: (origin[1] - rect.top) / currentZoom,
              origin
            }
      setManualZoom(true)
      setZoom(nextZoom)
    })
  }, [minZoom])

  const hasPages = !error && pageCount > 0
  const contentStyle = { zoom } as CSSProperties

  return (
    <FilePreviewLayout.Frame>
      <WordFilePreviewToolbar
        currentPage={hasPages ? currentPage : 0}
        pageCount={hasPages ? pageCount : 0}
        zoomLabel={formatDocxZoom(zoom)}
        canPreviousPage={hasPages && currentPage > 1}
        canNextPage={hasPages && currentPage < pageCount}
        canZoomOut={hasPages && zoom > minZoom}
        canZoomIn={hasPages && zoom < DOCX_PREVIEW_MAX_ZOOM}
        canResetZoom={hasPages && (fitWidth ? manualZoom : zoom !== DOCX_PREVIEW_DEFAULT_ZOOM)}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        onZoomOut={() => zoomBy('out')}
        onZoomIn={() => zoomBy('in')}
        onResetZoom={resetZoom}
      />
      <FilePreviewLayout.Content scrollsInternally>
        <div data-testid="word-file-preview" className="relative h-full min-h-0 w-full overflow-hidden bg-background">
          <div
            ref={containerRef}
            style={
              options?.bottomInset === 'content'
                ? { paddingBottom: 'var(--file-preview-bottom-inset, 0px)' }
                : undefined
            }
            role="region"
            aria-label={fileName}
            className="absolute inset-0 touch-pan-x touch-pan-y overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            tabIndex={0}>
            <div ref={styleRef} />
            <div
              ref={bodyRef}
              data-testid="docx-preview-content"
              data-zoom={zoom}
              data-picker={onSelection ? 'true' : undefined}
              onClick={handlePick}
              style={contentStyle}
              className="mx-auto w-fit min-w-0 [&[data-picker=true]_p[data-docx-part=body]:not([data-docx-picked=true]):hover]:bg-primary/10 [&[data-picker=true]_p[data-docx-part=body]]:cursor-pointer [&_.docx-preview-wrapper]:mx-auto [&_.docx-preview]:box-border [&_.docx-preview]:max-w-full [&_p[data-docx-picked=true]]:bg-primary/15 [&_p[data-docx-picked=true]]:outline [&_p[data-docx-picked=true]]:outline-1 [&_p[data-docx-picked=true]]:outline-primary/60 [&_section]:overflow-hidden [&_section]:rounded-sm [&_section]:shadow-md"
            />
          </div>
          {loading ? (
            <div
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              <span>{t('file_preview.loading')}</span>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="absolute inset-0 bg-background">
              {error instanceof PreviewError && error.code === 'too_large' ? (
                <FilePreviewTooLarge sizeBytes={previewDocument.size} limitBytes={DOCX_PREVIEW_MAX_SOURCE_BYTES} />
              ) : (
                <EmptyState
                  icon={AlertCircle}
                  title={t('file_preview.load_error.title')}
                  description={t('file_preview.load_error.description')}
                  className="h-full"
                />
              )}
            </div>
          ) : null}
        </div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
