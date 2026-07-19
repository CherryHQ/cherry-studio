import { EmptyState } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { createFilePathHandle } from '@shared/utils/file'
import { renderAsync } from 'docx-preview'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { assertDocxZipLimits } from './docxZipPreflight'
import { WordFilePreviewToolbar } from './WordFilePreviewToolbar'

const logger = loggerService.withContext('WordFilePreview')

const DOCX_PREVIEW_DEFAULT_ZOOM = 1
const DOCX_PREVIEW_ZOOM_STEP = 0.1
const DOCX_PREVIEW_MIN_ZOOM = 0.5
const DOCX_PREVIEW_MAX_ZOOM = 2
const DOCX_PREVIEW_MAX_SOURCE_BYTES = 25 * 1024 * 1024
const SAFE_HYPERLINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const formatDocxZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`

function toUint8Array(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
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

export default function WordFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const renderTokenRef = useRef(0)
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

    const token = ++renderTokenRef.current
    const isCurrent = () => renderTokenRef.current === token
    setError(null)
    setLoading(true)
    setCurrentPage(0)
    setPageCount(0)
    setZoom(DOCX_PREVIEW_DEFAULT_ZOOM)

    const stagingHost = document.createElement('div')
    const stagingBody = document.createElement('div')
    const stagingStyle = document.createElement('div')
    stagingHost.style.cssText = 'position:fixed;top:0;left:-99999px;visibility:hidden;'
    stagingHost.append(stagingStyle, stagingBody)
    document.body.appendChild(stagingHost)

    void (async () => {
      try {
        // Preflight the size via metadata (a stat, not a read) so oversized files
        // are rejected before we allocate + IPC-transfer the whole document.
        const metadata = await window.api.file.getMetadata(createFilePathHandle(filePath))
        if (!isCurrent()) return
        assertSourceSize(metadata.size)

        const docxData = toUint8Array(await window.api.fs.read(filePath))
        assertSourceSize(docxData.byteLength)
        if (!isCurrent()) return

        assertDocxZipLimits(docxData)
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
        logger.error(`Failed to load DOCX preview: ${filePath}`, normalized)
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
      stagingHost.remove()
    }
  }, [filePath, focusContainer, refreshKey])

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
        canZoomOut={hasPages && zoom > DOCX_PREVIEW_MIN_ZOOM}
        canZoomIn={hasPages && zoom < DOCX_PREVIEW_MAX_ZOOM}
        canResetZoom={hasPages && zoom !== DOCX_PREVIEW_DEFAULT_ZOOM}
        onPreviousPage={() => jumpToPage(currentPage - 1)}
        onNextPage={() => jumpToPage(currentPage + 1)}
        onZoomOut={() => zoomBy('out')}
        onZoomIn={() => zoomBy('in')}
        onResetZoom={resetZoom}
      />
      <FilePreviewLayout.Content>
        <div data-testid="word-file-preview" className="relative h-full min-h-0 w-full overflow-hidden bg-background">
          <div
            ref={containerRef}
            role="region"
            aria-label={fileName}
            className="absolute inset-0 overflow-auto bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
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
