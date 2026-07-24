import { Button, Dialog, DialogContent, DialogTitle, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import HtmlPreviewFrame, { HTML_PREVIEW_RESTRICTED_CSP } from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { htmlArtifactRequiresUserConsent } from '@renderer/utils/htmlArtifact'
import { isMac } from '@renderer/utils/platform'
import { HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX, HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'
import type { ConsoleMessageEvent, WebviewTag } from 'electron'
import { Code2, DownloadIcon, Eye, LinkIcon, Maximize2, Minimize2, ShieldAlert, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('HtmlArtifactView')

const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const INITIAL_PREVIEW_HEIGHT = 240
const MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.72
const HTML_ARTIFACT_BRIDGE_KEY = '__cherryHtmlArtifactBridgeCleanup'

interface HtmlArtifactViewProps {
  html: string
  title: string
}

type HtmlArtifactBridgeMessage =
  | { type: 'height'; value: number }
  | {
      type: 'wheel'
      value: number
    }

function getHtmlArtifactBridgeScript(messagePrefix: string): string {
  return `(() => {
    const bridgeKey = ${JSON.stringify(HTML_ARTIFACT_BRIDGE_KEY)}
    const previousCleanup = window[bridgeKey]
    if (typeof previousCleanup === 'function') previousCleanup()

    const send = (type, value) => {
      console.debug(${JSON.stringify(messagePrefix)} + JSON.stringify({ type, value }))
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
      if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return

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
    window[bridgeKey] = () => {
      resizeObserver?.disconnect()
      window.removeEventListener('load', reportHeight, true)
      window.removeEventListener('resize', reportHeight)
      window.removeEventListener('wheel', handleWheel, true)
    }
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
  const src = useMemo(() => `${HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX}${encodeURIComponent(html)}`, [html])

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

    const installBridge = () => {
      void webview.executeJavaScript(getHtmlArtifactBridgeScript(messagePrefix)).catch((error) => {
        logger.warn('Failed to install HTML artifact preview bridge', error as Error)
      })
    }

    webview.addEventListener('dom-ready', installBridge)
    webview.addEventListener('did-finish-load', installBridge)
    webview.addEventListener('console-message', handleConsoleMessage)

    return () => {
      webview.removeEventListener('dom-ready', installBridge)
      webview.removeEventListener('did-finish-load', installBridge)
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

const StaticHtmlFullscreenPreview = memo(function StaticHtmlFullscreenPreview({
  html,
  title,
  zoom
}: {
  html: string
  title: string
  zoom: number
}) {
  const zoomScale = zoom / 100

  return (
    <div data-testid="static-html-fullscreen-preview" className="relative h-full w-full overflow-hidden">
      <div
        className="origin-top-left"
        style={{
          width: `${100 / zoomScale}%`,
          height: `${100 / zoomScale}%`,
          transform: `scale(${zoomScale})`
        }}>
        <HtmlPreviewFrame html={html} title={title} sandbox="allow-same-origin" csp={HTML_PREVIEW_RESTRICTED_CSP} />
      </div>
    </div>
  )
})

const HtmlArtifactFullscreen = memo(function HtmlArtifactFullscreen({
  open,
  interactive,
  html,
  title,
  zoom,
  onZoomOut,
  onResetZoom,
  onZoomIn,
  onClose
}: {
  open: boolean
  interactive: boolean
  html: string
  title: string
  zoom: number
  onZoomOut: () => void
  onResetZoom: () => void
  onZoomIn: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return

    const body = document.body
    const originalOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = originalOverflow
    }
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}>
      <DialogContent
        data-testid="html-artifact-fullscreen"
        showCloseButton={false}
        closeOnOverlayClick={false}
        overlayClassName="hidden"
        aria-describedby={undefined}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="top-0! left-0! z-10000 h-screen w-screen max-w-none translate-x-0! translate-y-0! gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:max-w-none">
        <div className="grid h-full min-h-0 grid-rows-[45px_minmax(0,1fr)]">
          <header className="relative flex items-center justify-between gap-4 border-border border-b bg-background px-2.5 [-webkit-app-region:drag]">
            <div className={cn('min-w-0 flex-1', isMac ? 'pl-20' : 'pl-3')}>
              <DialogTitle className="max-w-[45vw] truncate font-bold text-foreground text-sm">{title}</DialogTitle>
            </div>
            <div className="flex flex-1 items-center justify-end gap-0.5 pr-1 [-webkit-app-region:no-drag]">
              <Tooltip content={t('preview.zoom_out')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('preview.zoom_out')}
                  disabled={zoom <= MIN_ZOOM}
                  onClick={onZoomOut}>
                  <ZoomOut className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.reset')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-10 px-1 text-muted-foreground text-xs tabular-nums"
                  aria-label={t('preview.reset')}
                  onClick={onResetZoom}>
                  {zoom}%
                </Button>
              </Tooltip>
              <Tooltip content={t('preview.zoom_in')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('preview.zoom_in')}
                  disabled={zoom >= MAX_ZOOM}
                  onClick={onZoomIn}>
                  <ZoomIn className="size-3.5" />
                </Button>
              </Tooltip>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              <Tooltip content={t('common.minimize')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.minimize')}
                  onClick={onClose}>
                  <Minimize2 className="size-3.5" />
                </Button>
              </Tooltip>
            </div>
          </header>
          <div className="min-h-0 overflow-hidden bg-background">
            {interactive ? (
              <InteractiveHtmlPreview html={html} title={title} zoom={zoom} forwardBoundaryWheel={false} />
            ) : (
              <StaticHtmlFullscreenPreview html={html} title={title} zoom={zoom} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})

const HtmlArtifactConsentCard = memo(function HtmlArtifactConsentCard({
  title,
  description,
  actionLabel,
  fullscreenLabel,
  onAccept,
  onOpenFullscreen
}: {
  title: string
  description: string
  actionLabel: string
  fullscreenLabel: string
  onAccept: () => void
  onOpenFullscreen: () => void
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
        <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 font-medium text-[10px] text-foreground-muted leading-4">
          HTML
        </span>
      </div>
      <div className="mr-2 flex shrink-0 items-center gap-0.5">
        <Tooltip content={description} delay={300}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-h-7 shrink-0 px-2 text-foreground-muted opacity-70 hover:bg-background hover:text-foreground hover:opacity-100"
            aria-describedby={descriptionId}
            onClick={onAccept}>
            <ShieldAlert className="size-3.5" />
            {actionLabel}
          </Button>
        </Tooltip>
        <Tooltip content={fullscreenLabel} delay={500}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-foreground-muted opacity-70 hover:bg-background hover:text-foreground hover:opacity-100"
            aria-label={fullscreenLabel}
            aria-describedby={descriptionId}
            onClick={onOpenFullscreen}>
            <Maximize2 className="size-3.5" />
          </Button>
        </Tooltip>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </div>
    </div>
  )
})

export const HtmlArtifactView = memo(function HtmlArtifactView({ html, title }: HtmlArtifactViewProps) {
  const { t } = useTranslation()
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [previewHeight, setPreviewHeight] = useState(INITIAL_PREVIEW_HEIGHT)
  const [approvedInteractiveHtml, setApprovedInteractiveHtml] = useState<string | null>(null)
  const [fullscreenHtml, setFullscreenHtml] = useState<string | null>(null)
  const hasContent = html.trim().length > 0
  const requiresUserConsent = useMemo(() => htmlArtifactRequiresUserConsent(html), [html])
  const isInteractivePreviewApproved = requiresUserConsent && approvedInteractiveHtml === html
  const isPreviewBlocked = requiresUserConsent && !isInteractivePreviewApproved
  const isFullscreen = fullscreenHtml === html && !isPreviewBlocked
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
  const handleApproveInteractivePreview = () => {
    setApprovedInteractiveHtml(html)
    setViewMode('preview')
    setFullscreenHtml(null)
  }
  const handleOpenInteractiveFullscreen = () => {
    setApprovedInteractiveHtml(html)
    setViewMode('preview')
    setFullscreenHtml(html)
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
          fullscreenLabel={t('common.maximize')}
          onAccept={handleApproveInteractivePreview}
          onOpenFullscreen={handleOpenInteractiveFullscreen}
        />
      </div>
    )
  }

  return (
    <div data-testid="html-artifact-view" className="w-full">
      {!isFullscreen && (
        <div
          data-testid="html-artifact-surface"
          className="group relative w-full overflow-hidden"
          style={{ height: surfaceHeight }}>
          {showCode ? (
            <div className="h-full min-h-0">
              <CodeViewer value={html} language="html" height="100%" expanded={false} className="h-full" />
            </div>
          ) : requiresUserConsent ? (
            <InteractiveHtmlPreview html={html} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
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
            {!showCode && (
              <Tooltip content={t('common.maximize')} delay={500}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t('common.maximize')}
                  onClick={() => setFullscreenHtml(html)}>
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
      )}
      <HtmlArtifactFullscreen
        open={isFullscreen}
        interactive={requiresUserConsent}
        html={html}
        title={title}
        zoom={zoom}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onZoomIn={handleZoomIn}
        onClose={() => setFullscreenHtml(null)}
      />
    </div>
  )
})
