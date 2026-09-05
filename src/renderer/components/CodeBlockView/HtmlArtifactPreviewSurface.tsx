import {
  clampForwardedWheelDelta,
  type ScrollRuntimeBoundary,
  useScrollRuntimeBoundary,
  VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX,
  VERTICAL_SCROLLABLE_OVERFLOW_PATTERN_SOURCE
} from '@renderer/components/chat/messages/list/ScrollOwnershipContext'
import HtmlPreviewFrame, {
  HTML_PREVIEW_RESTRICTED_CSP,
  injectHtmlPreviewHeadElement,
  injectHtmlPreviewScrollbarGutter
} from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import { htmlArtifactRequiresUserConsent, stripMetaRefresh } from '@renderer/utils/htmlArtifact'
import { HTML_ARTIFACT_PREVIEW_DATA_URL_PREFIX, HTML_ARTIFACT_PREVIEW_PARTITION } from '@shared/utils/htmlArtifact'
import type { ConsoleMessageEvent, WebviewTag } from 'electron'
import { memo, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react'

export const SCROLL_ACTIVATION_DELAY_MS = 300
const MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO = 0.72

type HtmlArtifactBridgeMessage =
  | { type: 'height'; value: number }
  | {
      type: 'wheel'
      value: number
    }

/** True when the content needs the hardened webview tier: scripts/embeds (`script`/
 *  `iframe`/`object`/`embed`, `on*` handlers, `javascript:` URLs), meta-refresh, external
 *  resource URLs, or external CSS `url()`s — regardless of fragment/document
 *  classification (the restricted-CSP frame would block external resources). A content
 *  check only; the consent decision is the caller's `authorized` prop. Fail-closed on
 *  content-parse errors. */
export function htmlArtifactPreviewRequiresInteractive(html: string): boolean {
  return htmlArtifactRequiresUserConsent(html)
}

function getHtmlArtifactBridgeScript(messagePrefix: string, scrollActivationDelay: number): string {
  return `(() => {
    const sendConsoleMessage = console.debug.bind(console)
    document.currentScript?.remove()
    let scrollbarRoot = null
    const applyScrollbarGutter = () => {
      const nextScrollbarRoot = document.scrollingElement ?? document.documentElement
      if (!nextScrollbarRoot?.style) return
      if (scrollbarRoot && scrollbarRoot !== nextScrollbarRoot) scrollbarRoot.style.scrollbarGutter = ''
      scrollbarRoot = nextScrollbarRoot
      scrollbarRoot.style.scrollbarGutter = 'stable'
    }
    applyScrollbarGutter()
    // Re-apply once body exists: quirks/doctype-less scrollingElement becomes body after head runs.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyScrollbarGutter, true)
    } else {
      applyScrollbarGutter()
    }
    const send = (type, value) => {
      sendConsoleMessage(${JSON.stringify(messagePrefix)} + JSON.stringify({ type, value }))
    }
    let lastReportedHeight = -1
    const scrollableOverflowPattern = new RegExp(${JSON.stringify(
      `^(?:${VERTICAL_SCROLLABLE_OVERFLOW_PATTERN_SOURCE})$`
    )})
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
      if (!element || element.scrollHeight <= element.clientHeight + ${VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX}) return false
      const style = getComputedStyle(element)
      if (!isRoot && !scrollableOverflowPattern.test(style.overflowY)) return false
      if (style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') return true
      if (deltaY < 0) return element.scrollTop > 0
      return deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - ${VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX}
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
    window.addEventListener('load', () => {
      applyScrollbarGutter()
      reportHeight()
    }, true)
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

/** Child realms report deltas; only the owning runtime may write the message viewport. */
export function routeWheelScroll(viewport: HTMLElement, scrollRuntime: ScrollRuntimeBoundary, deltaY: number): void {
  if (scrollRuntime.scrollByWheel(deltaY)) return
  viewport.ownerDocument.defaultView?.scrollBy({ top: clampForwardedWheelDelta(deltaY) })
}

export function getMaxPreviewHeight(viewport: HTMLElement, scrollContainer: HTMLElement | null): number {
  const scroller = scrollContainer?.contains(viewport) ? scrollContainer : null
  const scrollerHeight = scroller ? Math.max(scroller.clientHeight, scroller.getBoundingClientRect().height) : 0
  const availableHeight = scrollerHeight > 0 ? scrollerHeight : (viewport.ownerDocument.defaultView?.innerHeight ?? 0)
  return Math.max(1, Math.floor(availableHeight * MAX_PREVIEW_VIEWPORT_HEIGHT_RATIO))
}

export const StaticHtmlPreview = memo(function StaticHtmlPreview({
  html,
  title,
  zoom,
  iframeRef,
  emptyText
}: {
  html: string
  title: string
  zoom: number
  iframeRef?: RefObject<HTMLIFrameElement | null>
  emptyText?: string
}) {
  const zoomScale = zoom / 100
  // The static tier is a preview, never navigation: meta-refresh survives the
  // script-less sandbox (navigation needs no JS) and CSP cannot govern navigations.
  const staticHtml = useMemo(() => stripMetaRefresh(html), [html])

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
          html={staticHtml}
          title={title}
          iframeRef={iframeRef}
          sandbox="allow-same-origin"
          csp={HTML_PREVIEW_RESTRICTED_CSP}
          stableScrollbarGutter
          emptyText={emptyText}
        />
      </div>
    </div>
  )
})

export const InteractiveHtmlPreview = memo(function InteractiveHtmlPreview({
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
  const scrollRuntime = useScrollRuntimeBoundary()
  const zoomScale = zoom / 100
  const [messagePrefix] = useState(() => `__cherry_html_artifact_${crypto.randomUUID()}:`)
  const src = useMemo(() => {
    const scrollActivationDelay = forwardBoundaryWheel ? SCROLL_ACTIVATION_DELAY_MS : 0
    const bridgeScript = `<script>${getHtmlArtifactBridgeScript(messagePrefix, scrollActivationDelay)}</script>`
    const instrumentedHtml = injectHtmlPreviewHeadElement(injectHtmlPreviewScrollbarGutter(html), bridgeScript)
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

        const nextHeight = Math.min(
          getMaxPreviewHeight(viewport, scrollRuntime.getScrollContainer()),
          Math.max(1, Math.ceil(message.value * zoomScale))
        )
        onHeightChange(nextHeight)
        return
      }

      if (!forwardBoundaryWheel) return

      routeWheelScroll(viewport, scrollRuntime, message.value)
    }

    webview.addEventListener('console-message', handleConsoleMessage)

    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage)
    }
  }, [forwardBoundaryWheel, messagePrefix, onHeightChange, scrollRuntime, zoomScale])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const contentHeight = contentHeightRef.current
    if (!viewport || contentHeight === null || !onHeightChange) return

    const nextHeight = Math.min(
      getMaxPreviewHeight(viewport, scrollRuntime.getScrollContainer()),
      Math.max(1, Math.ceil(contentHeight * zoomScale))
    )
    onHeightChange(nextHeight)
  }, [onHeightChange, scrollRuntime, zoomScale])

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

/**
 * Two-tier preview surface for model-generated HTML.
 *
 * - inert content (no scripts/embeds) renders in the script-less same-origin frame
 *   (safe by construction: no scripts run, so `parent.api` is unreachable).
 * - active content — fragment or document — renders in the hardened `<webview>`
 *   partition instead: scripts run, but without the preload bridge.
 *
 * Consent contract: the interactive tier activates only when `authorized` is true —
 * never by mounting. Pass it true solely as the result of a semantically explicit user
 * action (the card popup's "View webpage" action, the maximize outlet's
 * documented open-interactive behavior); unauthorized callers get the script-less
 * fallback. Mount location alone carries no authority.
 */
export const HtmlArtifactPreviewSurface = memo(function HtmlArtifactPreviewSurface({
  html,
  title,
  authorized,
  zoom = 100,
  iframeRef,
  emptyText,
  forwardBoundaryWheel = true,
  onHeightChange
}: {
  html: string
  title: string
  /** Explicit user authorization for the interactive tier — the consent gate's input. */
  authorized: boolean
  zoom?: number
  iframeRef?: RefObject<HTMLIFrameElement | null>
  emptyText?: string
  forwardBoundaryWheel?: boolean
  onHeightChange?: (height: number) => void
}) {
  if (htmlArtifactPreviewRequiresInteractive(html)) {
    if (!authorized) {
      return <StaticHtmlPreview html={html} title={title} zoom={zoom} iframeRef={iframeRef} emptyText={emptyText} />
    }
    return (
      <InteractiveHtmlPreview
        html={html}
        title={title}
        zoom={zoom}
        onHeightChange={onHeightChange}
        forwardBoundaryWheel={forwardBoundaryWheel}
      />
    )
  }

  return <StaticHtmlPreview html={html} title={title} zoom={zoom} iframeRef={iframeRef} emptyText={emptyText} />
})

export default HtmlArtifactPreviewSurface
