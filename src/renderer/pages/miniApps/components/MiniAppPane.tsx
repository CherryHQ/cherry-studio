import { cn } from '@cherrystudio/ui/lib/utils'
import MiniAppLogoAvatar from '@renderer/components/icons/MiniAppLogoAvatar'
import { getWebviewLoaded, onWebviewStateChange, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { DidNavigateInPageEvent, WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'

import MinimalToolbar, { type SplitMode } from './MinimalToolbar'
import WebviewSearch from './WebviewSearch'

const MINI_APP_LOADING_COLOR = 'var(--muted-foreground)'

interface Props {
  app: MiniApp
  /** Whether this pane's toolbar offers to open the split or to close it. */
  splitMode: SplitMode
  /** Whether the view is currently split, so the control reads as engaged. */
  splitActive?: boolean
  onSplit: () => void
  /** Whether this pane answers the host window's Find shortcut. */
  hostShortcutEnabled?: boolean
  /** Whether annotation commands from this host pane may control the guest. */
  isHostActive: boolean
  /** Fired when the user interacts with this pane, so the page can track focus. */
  onActivate?: () => void
  className?: string
}

function useConcreteWebview(appId: string, isReady: boolean) {
  const webviewRef = useRef<WebviewTag | null>(null)
  const revisionRef = useRef(0)
  const selector = useMemo(() => `webview[data-mini-app-id="${CSS.escape(appId)}"]`, [appId])
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!isReady) return () => {}

      const observer = new MutationObserver(() => listener())
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    },
    [isReady]
  )
  const getSnapshot = useCallback(() => {
    const webview = isReady ? document.querySelector<WebviewTag>(selector) : null
    if (webviewRef.current !== webview) {
      webviewRef.current = webview
      revisionRef.current++
    }
    return revisionRef.current
  }, [isReady, selector])

  const webviewRevision = useSyncExternalStore(subscribe, getSnapshot, () => 0)
  return { webviewRef, webviewRevision }
}

/**
 * One mini app pane: toolbar, in-page search and loading mask laid over the
 * `<webview>` that {@link MiniAppTabsPool} renders underneath. The pane itself
 * is transparent so the pooled webview shows through.
 */
const MiniAppPane: FC<Props> = ({
  app,
  splitMode,
  splitActive,
  onSplit,
  hostShortcutEnabled,
  isHostActive,
  onActivate,
  className
}) => {
  const { t } = useTranslation()
  const displayName = app.nameKey ? t(app.nameKey) : app.name
  // Read through a ref so attaching the webview listener does not depend on a
  // callback identity that changes every render.
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  // Seed isReady from the pool's own state, not a load event: a pane remounting
  // over an already-loaded webview must not flash the mask, which reads as a reload.
  const [isReady, setIsReady] = useState<boolean>(() => getWebviewLoaded(app.appId))
  const [currentUrl, setCurrentUrl] = useState<string | null>(app.url)
  const { webviewRef, webviewRevision } = useConcreteWebview(app.appId, isReady)
  const webview = webviewRef.current

  useEffect(() => {
    if (!webview) return

    const handleInPageNav = (event: DidNavigateInPageEvent) => {
      if (event.isMainFrame) setCurrentUrl(event.url)
    }
    // Clicking into the page focuses the webview element itself; that is the
    // only signal the host gets, since events inside the guest never bubble out.
    const handleFocus = () => onActivateRef.current?.()
    webview.addEventListener('did-navigate-in-page', handleInPageNav)
    webview.addEventListener('focus', handleFocus)
    return () => {
      webview.removeEventListener('did-navigate-in-page', handleInPageNav)
      webview.removeEventListener('focus', handleFocus)
    }
  }, [webview])

  // Keep local readiness synchronized across load, LRU eviction, and recreation.
  useEffect(() => {
    const unsubscribe = onWebviewStateChange(app.appId, setIsReady)
    setIsReady(getWebviewLoaded(app.appId))
    return unsubscribe
  }, [app.appId])

  const handleReload = useCallback(() => {
    if (!isReady || !getWebviewLoaded(app.appId)) return
    if (!webview?.isConnected) return

    setWebviewLoaded(app.appId, false)
    setIsReady(false)
    webview.reload()
  }, [app.appId, isReady, webview])

  const handleOpenDevTools = useCallback(() => {
    webview?.openDevTools()
  }, [webview])

  const isWebviewReady = isReady && webview !== null

  return (
    <div
      className={cn('pointer-events-none relative flex h-full min-h-0 flex-col *:pointer-events-auto', className)}
      onFocusCapture={onActivate}
      onMouseDownCapture={onActivate}>
      <div className="shrink-0">
        <MinimalToolbar
          app={app}
          webviewRef={webviewRef}
          webviewRevision={webviewRevision}
          // currentUrl may be null (navigation not yet captured); fallback to app.url when opening externally
          currentUrl={currentUrl}
          isWebviewReady={isWebviewReady}
          isHostActive={isHostActive}
          onReload={handleReload}
          onOpenDevTools={handleOpenDevTools}
          splitMode={splitMode}
          splitActive={splitActive}
          onSplit={onSplit}
        />
      </div>
      <WebviewSearch
        webviewRef={webviewRef}
        isWebviewReady={isWebviewReady}
        appId={app.appId}
        hostShortcutEnabled={hostShortcutEnabled}
      />
      {!isReady && (
        <div className="absolute inset-x-0 top-8.75 bottom-0 z-4 flex flex-col items-center justify-center gap-3 bg-card">
          <MiniAppLogoAvatar logo={app.logoSrc ?? app.logo} size={60} alt={displayName} />
          <BeatLoader color={MINI_APP_LOADING_COLOR} size={8} style={{ marginTop: 12 }} />
        </div>
      )}
    </div>
  )
}

export default MiniAppPane
