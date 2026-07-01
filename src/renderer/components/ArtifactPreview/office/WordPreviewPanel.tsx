import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { LoadingState } from '@renderer/components/chat/primitives'
import { renderAsync } from 'docx-preview'
import { AlertCircle } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DocumentPreviewToolbar from '../DocumentPreviewToolbar'
import { toUint8Array } from '../toUint8Array'

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

// docx-preview writes a hyperlink relationship's target straight onto the anchor's href with no
// protocol filtering, so a crafted `javascript:` link would otherwise execute in this renderer on click.
// Allowlist the safe schemes and strip everything else (fail closed): anything the URL parser rejects
// or that isn't explicitly safe loses its href. Relative and in-document links (e.g. `#bookmark`) inherit
// the base's https: scheme, so they resolve to a safe protocol and are preserved.
const SAFE_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

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
  const renderTokenRef = useRef(0)

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

    const token = ++renderTokenRef.current
    const isCurrent = () => renderTokenRef.current === token
    setError(null)
    setLoading(true)
    setCurrentPage(0)
    setPageCount(0)
    setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)

    // docx-preview writes directly into the containers it's given, and renderAsync() can't be
    // aborted mid-flight. Rendering into an off-screen staging pair (rather than the shared,
    // visible containers) means a stale render can never clobber a newer one that finished first -
    // the stale output is simply discarded once isCurrent() comes back false.
    const stagingHost = document.createElement('div')
    stagingHost.style.cssText = 'position:fixed;top:0;left:-99999px;visibility:hidden;'
    const stagingBody = document.createElement('div')
    const stagingStyle = document.createElement('div')
    stagingHost.append(stagingStyle, stagingBody)
    document.body.appendChild(stagingHost)

    void (async () => {
      try {
        if (typeof sourceSize === 'number') assertSourceSize(sourceSize)

        const docxData = toUint8Array(await window.api.fs.read(filePath))
        assertSourceSize(docxData.byteLength)
        if (!isCurrent()) return

        await renderAsync(docxData, stagingBody, stagingStyle, {
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
        if (!isCurrent()) return

        const pages = getRenderedPages(stagingBody)
        pages.forEach((page, index) => {
          page.id = `docx-preview-page-${index + 1}`
          page.dataset.docxPreviewPage = String(index + 1)
          page.classList.add('docx-preview-page')
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
        logger.error(`Failed to load DOCX: ${filePath}`, normalized)
        setError(normalized)
      } finally {
        if (isCurrent()) setLoading(false)
        stagingHost.remove()
      }
    })()

    return () => {
      renderTokenRef.current += 1
      bodyContainer.innerHTML = ''
      styleContainer.innerHTML = ''
    }
  }, [filePath, focusContainer, refreshKey, sourceSize])

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
          <LoadingState label={t('common.loading')} />
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
