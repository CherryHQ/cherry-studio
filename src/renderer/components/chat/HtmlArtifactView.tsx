import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import HtmlPreviewFrame from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { Code2, DownloadIcon, Eye, LinkIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('HtmlArtifactView')

const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const INITIAL_PREVIEW_HEIGHT = 240
const MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.72

interface HtmlArtifactViewProps {
  html: string
  title: string
}

function getIframeContentHeight(iframe: HTMLIFrameElement): number | null {
  try {
    const frameDocument = iframe.contentDocument
    const body = frameDocument?.body
    const documentElement = frameDocument?.documentElement
    const frameWindow = iframe.contentWindow
    if (!frameDocument || !body || !documentElement || !frameWindow) return null

    const bodyStyle = frameWindow.getComputedStyle(body)
    const bodyEndSpacing =
      (Number.parseFloat(bodyStyle.paddingBottom) || 0) + (Number.parseFloat(bodyStyle.borderBottomWidth) || 0)
    const bodyMarginBottom = Number.parseFloat(bodyStyle.marginBottom) || 0
    const scrollTop = frameWindow.scrollY || documentElement.scrollTop || body.scrollTop
    let renderedContentBottom = 0

    for (const child of body.children) {
      const bounds = child.getBoundingClientRect()
      if (bounds.width === 0 && bounds.height === 0) continue

      const childMarginBottom = Number.parseFloat(frameWindow.getComputedStyle(child).marginBottom) || 0
      renderedContentBottom = Math.max(
        renderedContentBottom,
        bounds.bottom + scrollTop + Math.max(childMarginBottom, bodyMarginBottom) + bodyEndSpacing
      )
    }

    const documentScrollHeight = Math.max(
      body.scrollHeight,
      documentElement.scrollHeight,
      frameDocument.scrollingElement?.scrollHeight ?? 0
    )
    const renderedContentHeight = Math.ceil(renderedContentBottom)

    if (documentScrollHeight > iframe.clientHeight + 1) {
      return Math.max(documentScrollHeight, renderedContentHeight)
    }

    return renderedContentHeight > 0 ? renderedContentHeight : documentScrollHeight || null
  } catch {
    return null
  }
}

function getMaxPreviewHeight(viewport: HTMLElement): number {
  const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
  const scrollerHeight = scroller ? Math.max(scroller.clientHeight, scroller.getBoundingClientRect().height) : 0
  const availableHeight = scrollerHeight > 0 ? scrollerHeight : window.innerHeight
  return Math.max(1, Math.floor(availableHeight * MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO))
}

function containIframeVerticalOverscroll(frameDocument: Document): void {
  // The iframe is a separate scroll context, so the message list cannot inspect
  // its wheel target. Keep boundary gestures from chaining into the chat scroller.
  const scrollRoot = (frameDocument.scrollingElement ?? frameDocument.documentElement) as HTMLElement
  scrollRoot.style.setProperty('overscroll-behavior-y', 'contain', 'important')
}

const AdaptiveHtmlPreview = memo(function AdaptiveHtmlPreview({
  html,
  title,
  zoom,
  onHeightChange
}: {
  html: string
  title: string
  zoom: number
  onHeightChange: (height: number) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const zoomScale = zoom / 100

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const iframe = iframeRef.current
    if (!viewport || !iframe) return

    let isDisposed = false
    let documentResizeObserver: ResizeObserver | undefined
    let documentMutationObserver: MutationObserver | undefined
    let observedDocument: Document | undefined

    const syncHeight = () => {
      const contentHeight = getIframeContentHeight(iframe)
      if (contentHeight === null) return

      const nextHeight = Math.min(getMaxPreviewHeight(viewport), Math.max(1, Math.ceil(contentHeight * zoomScale)))
      onHeightChange(nextHeight)
    }

    const observeDocument = () => {
      documentResizeObserver?.disconnect()
      documentMutationObserver?.disconnect()
      observedDocument?.removeEventListener('load', syncHeight, true)

      const frameDocument = iframe.contentDocument
      const body = frameDocument?.body
      if (!frameDocument || !body) return
      observedDocument = frameDocument

      containIframeVerticalOverscroll(frameDocument)
      syncHeight()

      if (typeof ResizeObserver !== 'undefined') {
        documentResizeObserver = new ResizeObserver(syncHeight)
        documentResizeObserver.observe(body)
        documentResizeObserver.observe(frameDocument.documentElement)
        for (const child of body.children) documentResizeObserver.observe(child)
      }

      if (typeof MutationObserver !== 'undefined') {
        documentMutationObserver = new MutationObserver(observeDocument)
        documentMutationObserver.observe(body, { childList: true, subtree: true, characterData: true })
      }

      frameDocument.addEventListener('load', syncHeight, true)
      void frameDocument.fonts?.ready.then(() => {
        if (!isDisposed) syncHeight()
      })
    }

    observeDocument()
    iframe.addEventListener('load', observeDocument)
    window.addEventListener('resize', syncHeight)

    let layoutResizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      layoutResizeObserver = new ResizeObserver(syncHeight)
      layoutResizeObserver.observe(viewport)
      const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
      if (scroller) layoutResizeObserver.observe(scroller)
    }

    return () => {
      isDisposed = true
      documentResizeObserver?.disconnect()
      documentMutationObserver?.disconnect()
      layoutResizeObserver?.disconnect()
      observedDocument?.removeEventListener('load', syncHeight, true)
      iframe.removeEventListener('load', observeDocument)
      window.removeEventListener('resize', syncHeight)
    }
  }, [html, onHeightChange, zoomScale])

  return (
    <div ref={viewportRef} data-testid="adaptive-html-preview" className="relative h-full w-full overflow-hidden">
      <div
        data-testid="adaptive-html-zoom-layer"
        className="origin-top-left"
        style={{
          width: `${100 / zoomScale}%`,
          height: `${100 / zoomScale}%`,
          transform: `scale(${zoomScale})`
        }}>
        <HtmlPreviewFrame html={html} title={title} iframeRef={iframeRef} />
      </div>
    </div>
  )
})

export const HtmlArtifactView = memo(function HtmlArtifactView({ html, title }: HtmlArtifactViewProps) {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [previewHeight, setPreviewHeight] = useState(INITIAL_PREVIEW_HEIGHT)
  const hasContent = html.trim().length > 0
  const showCode = viewMode === 'code'
  const surfaceHeight = showCode ? Math.max(INITIAL_PREVIEW_HEIGHT, previewHeight) : previewHeight
  const toggleLabel = t(showCode ? 'html_artifacts.preview' : 'html_artifacts.code')
  const handleToggle = () => {
    setViewMode((current) => (current === 'preview' ? 'code' : 'preview'))
  }
  const handleZoomOut = () => {
    setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))
  }
  const handleZoomIn = () => {
    setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))
  }
  const handleResetZoom = () => {
    setZoom(DEFAULT_ZOOM)
  }
  const handleOpenExternal = async () => {
    try {
      const tempPath = await window.api.file.createTempFile('artifacts-preview.html')
      await window.api.file.write(tempPath, html)
      await window.api.file.openPath(tempPath)
    } catch (error) {
      logger.error('Failed to open HTML artifact externally', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('chat.artifacts.preview.openExternal.error.content')))
    }
  }
  const handleDownload = async () => {
    try {
      const fileName = `${getFileNameFromHtmlTitle(title) || 'html-artifact'}.html`
      const savedPath = await window.api.file.save(fileName, html)
      if (!savedPath) return

      toast.success(t('message.download.success'))
    } catch (error) {
      logger.error('Failed to download HTML artifact', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('message.download.failed')))
    }
  }

  return (
    <div data-testid="html-artifact-view" className="w-full">
      <div
        data-testid="html-artifact-surface"
        className="group relative w-full overflow-hidden"
        style={{ height: surfaceHeight }}>
        {showCode ? (
          <div className="h-full min-h-0">
            <CodeViewer value={html} language="html" height="100%" expanded={false} className="h-full" />
          </div>
        ) : (
          <AdaptiveHtmlPreview html={html} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
        )}

        <div
          data-testid="html-artifact-controls"
          className="pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border-subtle bg-popover p-0.5 opacity-0 shadow-sm transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 motion-reduce:transition-none">
          {!showCode && (
            <>
              <Tooltip content={t('preview.zoom_out')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('preview.zoom_out')}
                  disabled={zoom <= MIN_ZOOM}
                  onClick={handleZoomOut}>
                  <ZoomOut className="size-3" />
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.reset')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 min-h-6 min-w-9 px-1 text-muted-foreground text-xs tabular-nums"
                  aria-label={t('preview.reset')}
                  onClick={handleResetZoom}>
                  {zoom}%
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.zoom_in')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('preview.zoom_in')}
                  disabled={zoom >= MAX_ZOOM}
                  onClick={handleZoomIn}>
                  <ZoomIn className="size-3" />
                </Button>
              </Tooltip>
              <span className="h-3.5 w-px bg-border-subtle" />
            </>
          )}
          <Tooltip content={t('chat.artifacts.button.openExternal')} delay={500}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={t('chat.artifacts.button.openExternal')}
              disabled={!hasContent}
              onClick={handleOpenExternal}>
              <LinkIcon className="size-3" />
            </Button>
          </Tooltip>
          <Tooltip content={t('code_block.download.label')} delay={500}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={t('code_block.download.label')}
              disabled={!hasContent}
              onClick={handleDownload}>
              <DownloadIcon className="size-3" />
            </Button>
          </Tooltip>
          <span className="h-3.5 w-px bg-border-subtle" />
          <Tooltip content={toggleLabel} delay={500}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={toggleLabel}
              aria-pressed={showCode}
              onClick={handleToggle}>
              {showCode ? <Eye className="size-3" /> : <Code2 className="size-3" />}
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})
