import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import {
  HtmlArtifactPopupHost,
  useHtmlArtifactPopupContext,
  useOptionalHtmlArtifactPopupContext
} from '@renderer/components/chat/HtmlArtifactPopupContext'
import {
  canConsumeVerticalWheel,
  findVerticalWheelConsumer,
  useScrollRuntimeBoundary
} from '@renderer/components/chat/messages/list/ScrollOwnershipContext'
import type { HtmlArtifactKind } from '@renderer/components/chat/messages/markdown/plugins/remarkHtmlArtifact'
import {
  getMaxPreviewHeight,
  htmlArtifactPreviewRequiresInteractive,
  HtmlArtifactPreviewSurface,
  InteractiveHtmlPreview,
  routeWheelScroll,
  SCROLL_ACTIVATION_DELAY_MS
} from '@renderer/components/CodeBlockView/HtmlArtifactPreviewSurface'
import HtmlPreviewFrame, { HTML_PREVIEW_RESTRICTED_CSP } from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { stripMetaRefresh } from '@renderer/utils/htmlArtifact'
import { Code2, Compass, DownloadIcon, Eye, Maximize2, ShieldAlert, ZoomIn, ZoomOut } from 'lucide-react'
import {
  lazy,
  memo,
  type RefObject,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

const HtmlArtifactsPopup = lazy(() => import('@renderer/components/CodeBlockView/HtmlArtifactsPopup'))

const logger = loggerService.withContext('HtmlArtifactView')

const DEFAULT_ZOOM = 100
const MIN_ZOOM = 50
const MAX_ZOOM = 200
const ZOOM_STEP = 10
const INITIAL_PREVIEW_HEIGHT = 240
const MAX_STREAMING_PREVIEW_HEIGHT = 350
/** Preview rebuild cadence floor/ceiling. Each rebuild re-parses the whole document in the
 *  iframe (O(html size)), so the interval scales with size to bound per-second work. */
const STREAMING_PREVIEW_REFRESH_MS = 250
const STREAMING_PREVIEW_MAX_REFRESH_MS = 4000
const STREAMING_PREVIEW_CHARS_PER_MS = 2000

interface HtmlArtifactViewProps {
  /** Stable Markdown-node identity used only to preserve an open popup across renderer remounts. */
  artifactId?: string
  html: string
  title: string
  onSave?: (html: string) => void
  editable?: boolean
  /**
   * Drives the INLINE safety gate: only a whole `document` can be promoted to the inline
   * interactive webview, and only after consent; a `fragment` embedded in prose always
   * stays in the script-less inline frame. The maximize popup tiers by content alone
   * (see HtmlArtifactPopupOutlet) — an active fragment opens the webview there. Defaults
   * to `document` — a missing classification must fail closed.
   */
  kind?: HtmlArtifactKind
  /** Purely presentational: caps the height and hides the toolbar / code view while generating. */
  isStreaming?: boolean
}

function isWheelConsumedByEmbeddedDocument(event: WheelEvent): boolean {
  const targetNode = event.target as Node | null
  const element =
    targetNode?.nodeType === Node.ELEMENT_NODE ? (targetNode as Element) : (targetNode?.parentElement ?? null)
  const frameDocument = element?.ownerDocument
  if (!frameDocument) return false

  if (findVerticalWheelConsumer(element, event.deltaY, frameDocument.documentElement)) return true

  const root = frameDocument.scrollingElement ?? frameDocument.documentElement
  return canConsumeVerticalWheel(root, event.deltaY, true)
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

    // A last descendant's margin can collapse through otherwise margin-less wrappers. Measuring
    // only body.children then underestimates the natural document height and can make this preview
    // alternate forever between that smaller value and documentScrollHeight.
    for (const element of body.querySelectorAll('*')) {
      const bounds = element.getBoundingClientRect()
      if (bounds.width === 0 && bounds.height === 0) continue

      const elementMarginBottom = Number.parseFloat(frameWindow.getComputedStyle(element).marginBottom) || 0
      renderedContentBottom = Math.max(
        renderedContentBottom,
        bounds.bottom + scrollTop + Math.max(elementMarginBottom, bodyMarginBottom) + bodyEndSpacing
      )
    }

    // Bare text after the last element escapes querySelectorAll('*'), so measure the whole body
    // range too (jsdom omits Range#getBoundingClientRect, hence the guard).
    const contentRange = frameDocument.createRange()
    contentRange.selectNodeContents(body)
    if (typeof contentRange.getBoundingClientRect === 'function') {
      const contentRangeRect = contentRange.getBoundingClientRect()
      if (contentRangeRect.height > 0 || contentRangeRect.bottom > 0) {
        renderedContentBottom = Math.max(
          renderedContentBottom,
          contentRangeRect.bottom + scrollTop + bodyMarginBottom + bodyEndSpacing
        )
      }
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

function useDelayedScrollActivation<T extends HTMLElement>(viewportRef: RefObject<T | null>) {
  const isScrollActiveRef = useRef(true)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let activationTimer: ReturnType<typeof setTimeout> | undefined
    const lockScroll = () => {
      if (activationTimer !== undefined) {
        clearTimeout(activationTimer)
        activationTimer = undefined
      }
      isScrollActiveRef.current = false
    }
    const scheduleScrollActivation = () => {
      lockScroll()
      activationTimer = setTimeout(() => {
        activationTimer = undefined
        isScrollActiveRef.current = true
      }, SCROLL_ACTIVATION_DELAY_MS)
    }

    viewport.addEventListener('mouseenter', scheduleScrollActivation)
    viewport.addEventListener('mouseleave', lockScroll)
    if (viewport.matches(':hover')) scheduleScrollActivation()

    return () => {
      viewport.removeEventListener('mouseenter', scheduleScrollActivation)
      viewport.removeEventListener('mouseleave', lockScroll)
      if (activationTimer !== undefined) clearTimeout(activationTimer)
    }
  }, [viewportRef])

  return isScrollActiveRef
}

/**
 * Paces the HTML handed to the preview frame while generating.
 *
 * Any change to it swaps the iframe's `srcDoc`, and the browser answers that by discarding the
 * preview document and re-parsing it from scratch — which also reloads {@link AdaptiveHtmlPreview}'s
 * sizing observers and forces a synchronous layout over every body child. Per streamed token that
 * is a visible flicker and steady main-thread churn, so let the content settle between rebuilds.
 * Completed HTML is passed through untouched: it must render exactly and immediately.
 */
function useStreamingPacedHtml(html: string, isStreaming: boolean): string {
  const [pacedHtml, setPacedHtml] = useState(html)
  const latestHtmlRef = useRef(html)
  latestHtmlRef.current = html

  useEffect(() => {
    if (!isStreaming) return

    // Show whatever has arrived by the time generation starts, then rebuild on a
    // cadence that stretches as the document grows.
    setPacedHtml(latestHtmlRef.current)
    let timer: number
    const schedule = () => {
      const interval = Math.min(
        STREAMING_PREVIEW_MAX_REFRESH_MS,
        Math.max(STREAMING_PREVIEW_REFRESH_MS, latestHtmlRef.current.length / STREAMING_PREVIEW_CHARS_PER_MS)
      )
      timer = window.setTimeout(() => {
        setPacedHtml((current) => (current === latestHtmlRef.current ? current : latestHtmlRef.current))
        schedule()
      }, interval)
    }
    schedule()

    return () => window.clearTimeout(timer)
  }, [isStreaming])

  return isStreaming ? pacedHtml : html
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
  const isScrollActiveRef = useDelayedScrollActivation(viewportRef)
  const scrollRuntime = useScrollRuntimeBoundary()
  const zoomScale = zoom / 100
  // Same tier contract as StaticHtmlPreview: the static inline preview is a preview,
  // never navigation, so meta-refresh is stripped before the frame sees the bytes.
  const staticHtml = useMemo(() => stripMetaRefresh(html), [html])

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

      const nextHeight = Math.min(
        getMaxPreviewHeight(viewport, scrollRuntime.getScrollContainer()),
        Math.max(1, Math.ceil(contentHeight * zoomScale))
      )
      onHeightChange(nextHeight)
    }

    const forwardWheelIntent = (event: Event) => {
      const wheelEvent = event as WheelEvent
      if (!isScrollActiveRef.current) {
        wheelEvent.preventDefault()
        routeWheelScroll(viewport, scrollRuntime, wheelEvent.deltaY)
        return
      }

      if (isWheelConsumedByEmbeddedDocument(wheelEvent)) return
      scrollRuntime.notifyWheelIntent(wheelEvent.deltaY)
    }

    const observeDocument = () => {
      documentResizeObserver?.disconnect()
      documentMutationObserver?.disconnect()
      observedDocument?.removeEventListener('load', syncHeight, true)
      observedDocument?.removeEventListener('wheel', forwardWheelIntent, true)

      const frameDocument = iframe.contentDocument
      const body = frameDocument?.body
      if (!frameDocument || !body) return
      observedDocument = frameDocument

      // Capture phase: the frame's own content must not be able to swallow the signal.
      frameDocument.addEventListener('wheel', forwardWheelIntent, { capture: true, passive: false })

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
      const scroller = scrollRuntime.getScrollContainer()
      if (scroller?.contains(viewport)) layoutResizeObserver.observe(scroller)
    }

    return () => {
      isDisposed = true
      documentResizeObserver?.disconnect()
      documentMutationObserver?.disconnect()
      layoutResizeObserver?.disconnect()
      observedDocument?.removeEventListener('load', syncHeight, true)
      observedDocument?.removeEventListener('wheel', forwardWheelIntent, true)
      iframe.removeEventListener('load', observeDocument)
      window.removeEventListener('resize', syncHeight)
    }
  }, [html, isScrollActiveRef, onHeightChange, scrollRuntime, zoomScale])

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
          html={staticHtml}
          title={title}
          iframeRef={iframeRef}
          sandbox="allow-same-origin"
          csp={HTML_PREVIEW_RESTRICTED_CSP}
          stableScrollbarGutter
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
    <Tooltip content={description} delay={300} fullWidthTrigger>
      <Button
        type="button"
        variant="ghost"
        data-testid="html-artifact-consent-card"
        className="h-auto w-full max-w-xl justify-start gap-0 overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle p-0 font-[var(--font-family-body)] text-foreground hover:bg-accent"
        aria-label={actionLabel}
        aria-describedby={descriptionId}
        onClick={onAccept}>
        <span className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
            <Icon icon="material-icon-theme:html" className="text-[20px]" />
          </span>
          <span className="truncate font-medium text-[13px] text-foreground leading-5">{title}</span>
          <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground leading-4">
            HTML
          </span>
        </span>
        <span className="mr-2 flex shrink-0 items-center gap-1.5 px-2 text-muted-foreground">
          <ShieldAlert className="lucide-custom size-3.5 text-warning" />
          {actionLabel}
        </span>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </Button>
    </Tooltip>
  )
})

export function HtmlArtifactPopupOutlet() {
  const popupContext = useHtmlArtifactPopupContext()
  const popupSession = popupContext.popupSession
  if (!popupSession) return null

  // Opening the full-screen popup is the explicit viewing action, so it never renders a
  // consent surface — active content (fragment or document) goes straight to the webview.
  const requiresInteractivePreview = htmlArtifactPreviewRequiresInteractive(popupSession.html)
  // Only a whole document may be promoted in the INLINE view after viewing, so the
  // approve-on-close memory stays kind-gated (fragments remain script-less inline).
  const approvesInlineInteractive = requiresInteractivePreview && popupSession.kind === 'document'

  return (
    <Suspense fallback={null}>
      <HtmlArtifactsPopup
        open
        title={popupSession.title}
        html={popupSession.html}
        onSave={popupSession.onSave}
        editable={popupSession.editable}
        // Maximize opens the interactive tier directly (upstream for documents, this
        // PR's extension for active fragments); the card path defers to View webpage.
        canCapturePreview={!requiresInteractivePreview}
        renderPreview={(iframeRef) => (
          <HtmlArtifactPreviewSurface
            html={popupSession.html}
            title={popupSession.title}
            authorized
            zoom={popupSession.zoom}
            iframeRef={iframeRef}
            forwardBoundaryWheel={false}
          />
        )}
        onClose={() => {
          if (approvesInlineInteractive) {
            popupContext.approveInteractiveHtml(popupSession.artifactId, popupSession.html)
          }
          popupContext.closePopup()
        }}
      />
    </Suspense>
  )
}

const HtmlArtifactViewContent = memo(function HtmlArtifactViewContent({
  artifactId,
  html,
  title,
  onSave,
  editable = false,
  kind = 'document',
  isStreaming = false
}: HtmlArtifactViewProps & { artifactId: string }) {
  const { t } = useTranslation()
  const popupContext = useHtmlArtifactPopupContext()
  const { syncPopup } = popupContext
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [previewHeight, setPreviewHeight] = useState(INITIAL_PREVIEW_HEIGHT)
  const hasContent = html.trim().length > 0
  const previewHtml = useStreamingPacedHtml(html, isStreaming)
  const requiresUserConsent = useMemo(
    () => kind === 'document' && htmlArtifactPreviewRequiresInteractive(html),
    [html, kind]
  )
  const approvedInteractiveHtml = popupContext.approvedInteractiveHtmlById[artifactId]
  const isInteractivePreviewApproved = requiresUserConsent && approvedInteractiveHtml === html
  const isPreviewBlocked = requiresUserConsent && !isInteractivePreviewApproved
  const isPopupOpen = !isStreaming && popupContext.popupSession?.artifactId === artifactId
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
    popupContext.approveInteractiveHtml(artifactId, html)
    setViewMode('preview')
  }
  const handleOpenPopup = () => {
    popupContext.openPopup({
      artifactId,
      html,
      title,
      onSave,
      editable,
      kind,
      zoom
    })
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

  useLayoutEffect(() => {
    syncPopup({
      artifactId,
      html,
      title,
      onSave,
      editable,
      kind
    })
  }, [artifactId, editable, html, kind, onSave, syncPopup, title])

  if (isPreviewBlocked && !isPopupOpen) {
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
          className="group relative w-full overflow-hidden rounded-lg"
          style={{ height: surfaceHeight }}>
          <div className="relative h-full min-h-0 overflow-hidden bg-background">
            <div className={cn('h-full min-h-0', showCode && 'hidden')} aria-hidden={showCode || undefined}>
              {requiresUserConsent ? (
                // Not paced: the webview may only ever load the exact bytes the user consented to.
                <InteractiveHtmlPreview html={html} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
              ) : (
                <AdaptiveHtmlPreview html={previewHtml} title={title} zoom={zoom} onHeightChange={setPreviewHeight} />
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
                  <Compass className="size-3" />
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
                    onClick={handleOpenPopup}>
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
    </div>
  )
})

export const HtmlArtifactView = memo(function HtmlArtifactView(props: HtmlArtifactViewProps) {
  const popupContext = useOptionalHtmlArtifactPopupContext()
  const generatedArtifactId = useId()
  const artifactId = props.artifactId ?? generatedArtifactId

  return popupContext ? (
    <HtmlArtifactViewContent {...props} artifactId={artifactId} />
  ) : (
    <HtmlArtifactPopupHost>
      <HtmlArtifactViewContent {...props} artifactId={artifactId} />
    </HtmlArtifactPopupHost>
  )
})
