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
import { Code2, Compass, DownloadIcon, Eye, Maximize2, ShieldAlert, ZoomIn, ZoomOut } from 'lucide-react'
import {
  createContext,
  lazy,
  memo,
  type ReactNode,
  type RefObject,
  Suspense,
  use,
  useCallback,
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
const MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.72
const MAX_STREAMING_PREVIEW_HEIGHT = 350
const STREAMING_PREVIEW_REFRESH_MS = 250
const SCROLL_ACTIVATION_DELAY_MS = 300

interface HtmlArtifactViewProps {
  /** Stable Markdown-node identity used only to preserve an open popup across renderer remounts. */
  artifactId?: string
  html: string
  title: string
  onSave?: (html: string) => void
  editable?: boolean
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

interface HtmlArtifactPopupSession {
  artifactId: string
  html: string
  title: string
  onSave?: (html: string) => void
  editable: boolean
  kind: HtmlArtifactKind
  zoom: number
}

type HtmlArtifactPopupUpdate = Omit<HtmlArtifactPopupSession, 'zoom'>

interface HtmlArtifactPopupContextValue {
  approvedInteractiveHtmlById: Readonly<Record<string, string>>
  popupSession: HtmlArtifactPopupSession | null
  approveInteractiveHtml: (artifactId: string, html: string) => void
  openPopup: (session: HtmlArtifactPopupSession) => void
  syncPopup: (update: HtmlArtifactPopupUpdate) => void
  closePopup: () => void
}

const HtmlArtifactPopupContext = createContext<HtmlArtifactPopupContextValue | null>(null)

function useHtmlArtifactPopupContext(): HtmlArtifactPopupContextValue {
  const popupContext = use(HtmlArtifactPopupContext)
  if (!popupContext) {
    throw new Error('HTML artifact popup components must be rendered within HtmlArtifactPopupHost')
  }
  return popupContext
}

type HtmlArtifactBridgeMessage =
  | { type: 'height'; value: number }
  | {
      type: 'wheel'
      value: number
    }

function getHtmlArtifactBridgeScript(messagePrefix: string, scrollActivationDelay: number): string {
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
    const scrollActivationDelay = ${scrollActivationDelay}
    let isScrollActive = true
    let scrollActivationTimer = null
    const lockScroll = () => {
      if (scrollActivationTimer !== null) {
        clearTimeout(scrollActivationTimer)
        scrollActivationTimer = null
      }
      isScrollActive = false
    }
    const scheduleScrollActivation = () => {
      if (scrollActivationDelay === 0) return
      lockScroll()
      scrollActivationTimer = setTimeout(() => {
        scrollActivationTimer = null
        isScrollActive = true
      }, scrollActivationDelay)
    }
    const handleWheel = (event) => {
      if (!event.isTrusted || !Number.isFinite(event.deltaY) || event.deltaY === 0) return
      if (!isScrollActive) {
        event.preventDefault()
        send('wheel', event.deltaY)
        return
      }

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
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    if (scrollActivationDelay > 0) {
      document.documentElement.addEventListener('mouseenter', scheduleScrollActivation)
      document.documentElement.addEventListener('mouseleave', lockScroll)
      if (document.documentElement.matches(':hover')) scheduleScrollActivation()
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

/**
 * Replays a wheel that happened inside the preview onto the message list's scroller.
 *
 * A wheel inside the preview never reaches that scroller by itself: an iframe dispatches it in
 * its own document, and the webview is a separate process. The list stamps user scroll intent
 * from a wheel listener there, and without that stamp it reads the scroll that boundary chaining
 * just produced as drift -- so on an already user-owned viewport it answers by re-asserting the
 * frozen scrollTop before the next paint (`chatVirtualizerRuntime.tsx`, the non-user-initiated
 * branch of `onScroll`). Every further wheel chains again and is undone again, which is the
 * jitter. This carries the intent only: the scroll itself still comes from native chaining
 * (iframe) or the explicit `scrollBy` below (webview), since a synthetic wheel scrolls nothing.
 */
function replayWheelIntentOnScroller(viewport: HTMLElement, deltaY: number): void {
  const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
  const view = viewport.ownerDocument.defaultView
  if (!scroller || !view) return

  // Bubbling like a genuine wheel, so listeners attached by delegation see it too.
  scroller.dispatchEvent(new view.WheelEvent('wheel', { deltaY, bubbles: true }))
}

function forwardWheelToPage(viewport: HTMLElement, deltaY: number): void {
  const boundedDeltaY = Math.max(-200, Math.min(200, deltaY))
  const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
  if (scroller) {
    // Must precede the write: an unannounced `scrollBy` reads as drift and gets undone.
    replayWheelIntentOnScroller(viewport, boundedDeltaY)
    scroller.scrollBy({ top: boundedDeltaY })
  } else {
    window.scrollBy({ top: boundedDeltaY })
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

function getMaxPreviewHeight(viewport: HTMLElement): number {
  const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
  const scrollerHeight = scroller ? Math.max(scroller.clientHeight, scroller.getBoundingClientRect().height) : 0
  const availableHeight = scrollerHeight > 0 ? scrollerHeight : window.innerHeight
  return Math.max(1, Math.floor(availableHeight * MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO))
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

    // Show whatever has arrived by the time generation starts, then rebuild on a fixed cadence.
    setPacedHtml(latestHtmlRef.current)
    const timer = setInterval(() => {
      setPacedHtml((current) => (current === latestHtmlRef.current ? current : latestHtmlRef.current))
    }, STREAMING_PREVIEW_REFRESH_MS)

    return () => clearInterval(timer)
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

    const forwardWheelIntent = (event: Event) => {
      const wheelEvent = event as WheelEvent
      if (!isScrollActiveRef.current) {
        wheelEvent.preventDefault()
        forwardWheelToPage(viewport, wheelEvent.deltaY)
        return
      }

      replayWheelIntentOnScroller(viewport, wheelEvent.deltaY)
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
      const scroller = viewport.closest<HTMLElement>('[data-message-virtual-list-scroller]')
      if (scroller) layoutResizeObserver.observe(scroller)
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
  }, [html, isScrollActiveRef, onHeightChange, zoomScale])

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
    const scrollActivationDelay = forwardBoundaryWheel ? SCROLL_ACTIVATION_DELAY_MS : 0
    const bridgeScript = `<script>${getHtmlArtifactBridgeScript(messagePrefix, scrollActivationDelay)}</script>`
    const instrumentedHtml = injectHtmlPreviewHeadElement(html, bridgeScript)
    return `${HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX}${encodeURIComponent(instrumentedHtml)}`
  }, [forwardBoundaryWheel, html, messagePrefix])

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

      forwardWheelToPage(viewport, message.value)
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

function HtmlArtifactPopupOutlet() {
  const popupContext = useHtmlArtifactPopupContext()
  const popupSession = popupContext.popupSession
  if (!popupSession) return null

  // Opening the full-screen popup is the explicit viewing action, so it never renders a consent surface.
  const requiresInteractivePreview =
    popupSession.kind === 'document' && htmlArtifactRequiresUserConsent(popupSession.html)

  return (
    <Suspense fallback={null}>
      <HtmlArtifactsPopup
        open
        title={popupSession.title}
        html={popupSession.html}
        onSave={popupSession.onSave}
        editable={popupSession.editable}
        canCapturePreview={!requiresInteractivePreview}
        renderPreview={(iframeRef) =>
          requiresInteractivePreview ? (
            <InteractiveHtmlPreview
              html={popupSession.html}
              title={popupSession.title}
              zoom={popupSession.zoom}
              forwardBoundaryWheel={false}
            />
          ) : (
            <StaticHtmlPopupPreview
              html={popupSession.html}
              title={popupSession.title}
              zoom={popupSession.zoom}
              iframeRef={iframeRef}
            />
          )
        }
        onClose={() => {
          if (requiresInteractivePreview) {
            popupContext.approveInteractiveHtml(popupSession.artifactId, popupSession.html)
          }
          popupContext.closePopup()
        }}
      />
    </Suspense>
  )
}

export function HtmlArtifactPopupHost({ children }: { children: ReactNode }) {
  const [approvedInteractiveHtmlById, setApprovedInteractiveHtmlById] = useState<Record<string, string>>({})
  const [popupSession, setPopupSession] = useState<HtmlArtifactPopupSession | null>(null)
  const approveInteractiveHtml = useCallback((artifactId: string, html: string) => {
    setApprovedInteractiveHtmlById((current) =>
      current[artifactId] === html ? current : { ...current, [artifactId]: html }
    )
  }, [])
  const openPopup = useCallback((session: HtmlArtifactPopupSession) => {
    setPopupSession(session)
  }, [])
  const syncPopup = useCallback((update: HtmlArtifactPopupUpdate) => {
    setPopupSession((current) => {
      if (!current || current.artifactId !== update.artifactId) return current
      if (
        current.html === update.html &&
        current.title === update.title &&
        current.onSave === update.onSave &&
        current.editable === update.editable &&
        current.kind === update.kind
      ) {
        return current
      }
      return { ...current, ...update }
    })
  }, [])
  const closePopup = useCallback(() => {
    setPopupSession(null)
  }, [])
  const contextValue = useMemo<HtmlArtifactPopupContextValue>(
    () => ({
      approvedInteractiveHtmlById,
      popupSession,
      approveInteractiveHtml,
      openPopup,
      syncPopup,
      closePopup
    }),
    [approvedInteractiveHtmlById, approveInteractiveHtml, closePopup, openPopup, popupSession, syncPopup]
  )

  return (
    <HtmlArtifactPopupContext value={contextValue}>
      {children}
      <HtmlArtifactPopupOutlet />
    </HtmlArtifactPopupContext>
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
  const requiresUserConsent = useMemo(() => kind === 'document' && htmlArtifactRequiresUserConsent(html), [html, kind])
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
  const popupContext = use(HtmlArtifactPopupContext)
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
