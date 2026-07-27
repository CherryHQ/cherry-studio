import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import type { HtmlArtifactKind } from '@renderer/components/chat/messages/markdown/plugins/remarkHtmlArtifact'
import HtmlPreviewFrame, {
  HTML_PREVIEW_RESTRICTED_CSP,
  injectHtmlPreviewHeadElement
} from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { htmlArtifactRequiresUserConsent } from '@renderer/utils/htmlArtifact'
import { HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX, HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'
import type { ConsoleMessageEvent, WebviewTag } from 'electron'
import { Code2, DownloadIcon, Eye, LinkIcon, Maximize2, ShieldAlert, ZoomIn, ZoomOut } from 'lucide-react'
import { lazy, memo, type RefObject, Suspense, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HtmlArtifactsPopup = lazy(() => import('@renderer/components/CodeBlockView/HtmlArtifactsPopup'))

const logger = loggerService.withContext('HtmlArtifactView')

const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const INITIAL_PREVIEW_HEIGHT = 240
const MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.72
const MAX_STREAMING_PREVIEW_HEIGHT = 350

interface HtmlArtifactViewProps {
  html: string
  title: string
  /**
   * Drives the safety gate: only a whole `document` can be promoted to an interactive webview,
   * and only after consent. A `fragment` embedded in prose always stays in the script-less
   * preview frame, so it needs no gate. Defaults to `document` — a missing classification must
   * fail closed.
   */
  kind?: HtmlArtifactKind
  /** Purely presentational: caps the height and hides the toolbar / code view while generating. */
  isStreaming?: boolean
}

type HtmlArtifactBridgeMessage =
  | { type: 'height'; value: number }
  | {
      type: 'wheel'
      value: number
    }

function getHtmlArtifactBridgeScript(messagePrefix: string): string {
  return `(() => {
    const sendConsoleMessage = console.debug.bind(console)
    document.currentScript?.remove()
    const send = (type, value) => {
      sendConsoleMessage(${JSON.stringify(messagePrefix)} + JSON.stringify({ type, value }))
    }
    let lastReportedHeight = -1
    const reportHeight = () => {
      const bodyHeight = document.body?.scrollHeight ?? 0
      const rootHeight = document.documentElement?.scrollHeight ?? 0
      const scrollingHeight = document.scrollingElement?.scrollHeight ?? 0
      const height = Math.max(bodyHeight, rootHeight, scrollingHeight)
      if (height === lastReportedHeight) return
      lastReportedHeight = height
      send('height', height)
    }
    const canScroll = (element, deltaY, isRoot = false) => {
      if (!element || element.scrollHeight <= element.clientHeight + 1) return false
      if (!isRoot) {
        const overflowY = getComputedStyle(element).overflowY
        if (!/(auto|scroll|overlay)/.test(overflowY)) return false
      }
      if (deltaY < 0) return element.scrollTop > 0
      return element.scrollTop + element.clientHeight < element.scrollHeight - 1
    }
    const handleWheel = (event) => {
      if (!event.isTrusted || !Number.isFinite(event.deltaY) || event.deltaY === 0) return

      let element = event.target instanceof Element ? event.target : event.target?.parentElement
      while (element && element !== document.documentElement) {
        if (canScroll(element, event.deltaY)) return
        element = element.parentElement
      }

      const root = document.scrollingElement ?? document.documentElement
      if (!canScroll(root, event.deltaY, true)) send('wheel', event.deltaY)
    }

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reportHeight)
    if (resizeObserver) {
      resizeObserver.observe(document.documentElement)
      if (document.body) resizeObserver.observe(document.body)
    }
    window.addEventListener('load', reportHeight, true)
    window.addEventListener('resize', reportHeight)
    window.addEventListener('wheel', handleWheel, true)
    reportHeight()
  })()`
}

function parseHtmlArtifactBridgeMessage(message: string, messagePrefix: string): HtmlArtifactBridgeMessage | null {
  if (!message.startsWith(messagePrefix)) return null

  try {
    const payload = JSON.parse(message.slice(messagePrefix.length)) as Partial<HtmlArtifactBridgeMessage>
    if ((payload.type !== 'height' && payload.type !== 'wheel') || !Number.isFinite(payload.value)) return null
    return payload as HtmlArtifactBridgeMessage
  } catch {
    return null
  }
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
        {/* Keep same-origin only for parent-side sizing; generated scripts and forms stay blocked. */}
        <HtmlPreviewFrame
          html={html}
          title={title}
          iframeRef={iframeRef}
          sandbox="allow-same-origin"
          csp={HTML_PREVIEW_RESTRICTED_CSP}
        />
      </div>
    </div>
  )
})

const StaticHtmlPopupPreview = memo(function StaticHtmlPopupPreview({
  html,
  title,
  zoom,
  iframeRef
}: {
  html: string
  title: string
  zoom: number
  iframeRef: RefObject<HTMLIFrameElement | null>
}) {
  const zoomScale = zoom / 100

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="origin-top-left"
        style={{
          width: `${100 / zoomScale}%`,
          height: `${100 / zoomScale}%`,
          transform: `scale(${zoomScale})`
        }}>
        <HtmlPreviewFrame
          html={html}
          title={title}
          iframeRef={iframeRef}
          sandbox="allow-same-origin"
          csp={HTML_PREVIEW_RESTRICTED_CSP}
        />
      </div>
    </div>
  )
})

const InteractiveHtmlPreview = memo(function InteractiveHtmlPreview({
  html,
  title,
  zoom,
  onHeightChange,
  forwardBoundaryWheel = true
}: {
  html: string
  title: string
  zoom: number
  onHeightChange?: (height: number) => void
  forwardBoundaryWheel?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  const contentHeightRef = useRef<number | null>(null)
  const zoomScale = zoom / 100
  const [messagePrefix] = useState(() => `__cherry_html_artifact_${crypto.randomUUID()}:`)
  const src = useMemo(() => {
    const bridgeScript = `<script>${getHtmlArtifactBridgeScript(messagePrefix)}</script>`
    const instrumentedHtml = injectHtmlPreviewHeadElement(html, bridgeScript)
    return `${HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX}${encodeURIComponent(instrumentedHtml)}`
  }, [html, messagePrefix])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const webview = webviewRef.current
    if (!viewport || !webview) return

    const handleConsoleMessage = (event: ConsoleMessageEvent) => {
      const message = parseHtmlArtifactBridgeMessage(event.message, messagePrefix)
      if (!message) return

      if (message.type === 'height') {
        contentHeightRef.current = message.value
        if (!onHeightChange) return

        const nextHeight = Math.min(getMaxPreviewHeight(viewport), Math.max(1, Math.ceil(message.value * zoomScale)))
        onHeightChange(nextHeight)
        return
      }

      if (!forwardBoundaryWheel) return

      const deltaY = Math.max(-200, Math.min(200, message.value))
      const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
      if (scroller) {
        scroller.scrollBy({ top: deltaY })
      } else {
        window.scrollBy({ top: deltaY })
      }
    }

    webview.addEventListener('console-message', handleConsoleMessage)

    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage)
    }
  }, [forwardBoundaryWheel, messagePrefix, onHeightChange, zoomScale])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const contentHeight = contentHeightRef.current
    if (!viewport || contentHeight === null || !onHeightChange) return

    const nextHeight = Math.min(getMaxPreviewHeight(viewport), Math.max(1, Math.ceil(contentHeight * zoomScale)))
    onHeightChange(nextHeight)
  }, [onHeightChange, zoomScale])

  return (
    <div ref={viewportRef} data-testid="interactive-html-preview" className="relative h-full w-full overflow-hidden">
      <div
        data-testid="interactive-html-zoom-layer"
        className="origin-top-left"
        style={{
          width: `${100 / zoomScale}%`,
          height: `${100 / zoomScale}%`,
          transform: `scale(${zoomScale})`
        }}>
        <webview
          ref={webviewRef}
          data-testid="interactive-html-webview"
          src={src}
          partition={HTML_ARTIFACT_PREVIEW_PARTITION}
          aria-label={title}
          className="inline-flex h-full w-full bg-white"
        />
      </div>
    </div>
  )
})

const HtmlArtifactConsentCard = memo(function HtmlArtifactConsentCard({
  title,
  description,
  actionLabel,
  onAccept
}: {
  title: string
  description: string
  actionLabel: string
  onAccept: () => void
}) {
  const descriptionId = useId()

  return (
    <div
      data-testid="html-artifact-consent-card"
      className="flex w-full max-w-xl items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle font-[var(--font-family-body)]">
      <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
          <Icon icon="material-icon-theme:html" className="text-[20px]" />
        </span>
        <span className="truncate font-medium text-[13px] text-foreground leading-5">{title}</span>
        <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground leading-4">
          HTML
        </span>
      </div>
      <div className="mr-2 flex shrink-0 items-center gap-0.5">
        <Tooltip content={description} delay={300}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-h-7 shrink-0 px-2 text-muted-foreground opacity-70 hover:bg-background hover:text-foreground hover:opacity-100"
            aria-describedby={descriptionId}
            onClick={onAccept}>
            <ShieldAlert className="size-3.5" />
            {actionLabel}
          </Button>
        </Tooltip>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </div>
    </div>
  )
})

export const HtmlArtifactView = memo(function HtmlArtifactView({
  html,
  title,
  kind = 'document',
  isStreaming = false
}: HtmlArtifactViewProps) {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [previewHeight, setPreviewHeight] = useState(INITIAL_PREVIEW_HEIGHT)
  const [approvedInteractiveHtml, setApprovedInteractiveHtml] = useState<string | null>(null)
  const [popupHtml, setPopupHtml] = useState<string | null>(null)
  const hasContent = html.trim().length > 0
  const requiresUserConsent = useMemo(() => kind === 'document' && htmlArtifactRequiresUserConsent(html), [html, kind])
  const isInteractivePreviewApproved = requiresUserConsent && approvedInteractiveHtml === html
  const isPreviewBlocked = requiresUserConsent && !isInteractivePreviewApproved
  const isPopupOpen = !isStreaming && popupHtml === html && !isPreviewBlocked
  const showCode = !isStreaming && viewMode === 'code'
  const completedSurfaceHeight = showCode ? Math.max(INITIAL_PREVIEW_HEIGHT, previewHeight) : previewHeight
  const surfaceHeight = isStreaming
    ? Math.min(MAX_STREAMING_PREVIEW_HEIGHT, completedSurfaceHeight)
    : completedSurfaceHeight
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
  const handleApproveInteractivePreview = () => {
    setApprovedInteractiveHtml(html)
    setViewMode('preview')
    setPopupHtml(null)
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

  if (isPreviewBlocked) {
    return (
      <div data-testid="html-artifact-view" className="w-full">
        <HtmlArtifactConsentCard
          title={title}
          description={t('html_artifacts.interactive_preview.description')}
          actionLabel={t('html_artifacts.interactive_preview.action')}
          onAccept={handleApproveInteractivePreview}
        />
      </div>
    )
  }

  return (
    <div data-testid="html-artifact-view" className="w-full">
      {!isPopupOpen ? (
        <div
          data-testid="html-artifact-surface"
          className="group relative w-full overflow-hidden"
          style={{ height: surfaceHeight }}>
          <div className="relative h-full min-h-0 overflow-hidden bg-background">
            <div className={cn('h-full min-h-0', showCode && 'hidden')} aria-hidden={showCode || undefined}>
              {requiresUserConsent ? (
                <InteractiveHtmlPreview html={html} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
              ) : (
                <AdaptiveHtmlPreview html={html} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
              )}
            </div>
            {showCode && (
              <div className="h-full min-h-0">
                <CodeViewer value={html} language="html" height="100%" expanded={false} className="h-full" />
              </div>
            )}

            <div
              data-testid="html-artifact-controls"
              className={cn(
                'pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border-subtle bg-popover p-0.5 opacity-0 shadow-sm transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 motion-reduce:transition-none',
                isStreaming ? 'hidden' : undefined
              )}>
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
              {!showCode && (
                <Tooltip content={t('common.maximize')} delay={500}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    aria-label={t('common.maximize')}
                    onClick={() => setPopupHtml(html)}>
                    <Maximize2 className="size-3" />
                  </Button>
                </Tooltip>
              )}
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
      ) : null}

      {isPopupOpen ? (
        <Suspense fallback={null}>
          <HtmlArtifactsPopup
            open={isPopupOpen}
            title={title}
            html={html}
            editable={false}
            canCapturePreview={!requiresUserConsent}
            renderPreview={(iframeRef) =>
              requiresUserConsent ? (
                <InteractiveHtmlPreview html={html} title={title} zoom={zoom} forwardBoundaryWheel={false} />
              ) : (
                <StaticHtmlPopupPreview html={html} title={title} zoom={zoom} iframeRef={iframeRef} />
              )
            }
            onClose={() => setPopupHtml(null)}
          />
        </Suspense>
      ) : null}
    </div>
  )
})
