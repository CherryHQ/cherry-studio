import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getWebviewLoaded, onWebviewStateChange, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

// Tab mode page shell — relies on the global MiniAppTabsPool instead of creating WebViews directly
import MinimalToolbar from './components/MinimalToolbar'
import WebviewSearch from './components/WebviewSearch'

const logger = loggerService.withContext('MiniAppPage')

const MiniAppPage: FC = () => {
  const { t } = useTranslation()
  const { appId } = useParams({ strict: false })
  const { openMiniAppKeepAlive } = useMiniAppPopup()
  const { allApps, openedKeepAliveMiniApps, isLoading, error } = useMiniApps()
  const navigate = useNavigate()

  // Find the app from all available apps (including transient ones in the keep-alive list)
  const app = useMemo((): MiniApp | null => {
    if (!appId) return null
    const found = allApps.find((a) => a.appId === appId)
    if (found) return found
    // Fall back to the keep-alive list — covers temporary apps opened via openSmartMiniApp
    return openedKeepAliveMiniApps.find((a) => a.appId === appId) ?? null
  }, [appId, allApps, openedKeepAliveMiniApps])

  useEffect(() => {
    if (isLoading) return

    if (error) {
      logger.error('Failed to load mini apps', error instanceof DataApiError ? error : undefined)
      void navigate({ to: '/app/mini-app' })
      return
    }

    if (!app) {
      void navigate({ to: '/app/mini-app' })
      return
    }

    // Ensure the keep-alive pool picks up this app and currentMiniAppId stays
    // in sync with the route-changed appId.
    openMiniAppKeepAlive(app)
  }, [app, navigate, openMiniAppKeepAlive, isLoading, error])

  // -------------- Tab Shell logic --------------
  // Hooks must be called before any return, so define them early with null-checks inside
  const webviewRef = useRef<WebviewTag | null>(null)
  // Seed isReady from `appId` (synchronously available via useParams), not
  // from `app` (which goes through async DataApi/useMemo and is null on the
  // first render after a tab wakes from LRU hibernation). Otherwise the
  // loading mask flashes over a still-alive webview every time the user
  // switches back to the mini-app, looking like a reload.
  const [isReady, setIsReady] = useState<boolean>(() => (appId ? getWebviewLoaded(appId) : false))
  const [currentUrl, setCurrentUrl] = useState<string | null>(app?.url ?? null)

  // Get the webview element from the pool (avoid re-running on openedKeepAliveMiniApps.length changes)
  const webviewCleanupRef = useRef<(() => void) | null>(null)

  const attachWebview = useCallback(() => {
    if (!app) return true // No app — stop monitoring
    const selector = `webview[data-miniapp-id="${CSS.escape(app.appId)}"]`
    const el = document.querySelector<WebviewTag>(selector)
    if (!el) return false

    if (webviewRef.current === el) return true // Already attached

    webviewRef.current = el
    const handleInPageNav = (e: any) => setCurrentUrl(e.url)
    el.addEventListener('did-navigate-in-page', handleInPageNav)
    webviewCleanupRef.current = () => {
      el.removeEventListener('did-navigate-in-page', handleInPageNav)
    }
    return true
  }, [app])

  useEffect(() => {
    if (!app) return

    // Try immediate attachment first
    if (attachWebview()) return () => webviewCleanupRef.current?.()

    // If not yet created, observe DOM changes (lightweight + auto-disconnect)
    const observer = new MutationObserver(() => {
      if (attachWebview()) {
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      webviewCleanupRef.current?.()
    }
  }, [app, attachWebview])

  // Event-driven wait for load completion (replaces fixed 150ms polling)
  useEffect(() => {
    if (!app) return
    if (getWebviewLoaded(app.appId)) {
      // Already loaded
      if (!isReady) setIsReady(true)
      return
    }
    let mounted = true
    const unsubscribe = onWebviewStateChange(app.appId, (loaded) => {
      if (!mounted) return
      if (loaded) {
        setIsReady(true)
        unsubscribe()
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [app, isReady])

  // While loading, show a loading indicator instead of returning null
  if (isLoading) {
    return (
      <ShellContainer>
        <LoadingMask>
          <BeatLoader color="var(--color-text-2)" size={8} />
        </LoadingMask>
      </ShellContainer>
    )
  }

  // Show error state for DataApi errors
  if (error) {
    const isNotFound = error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND
    return (
      <ShellContainer>
        <LoadingMask>
          <ErrorText>{t(isNotFound ? 'miniApp.error.not_found' : 'miniApp.error.load_failed')}</ErrorText>
        </LoadingMask>
      </ShellContainer>
    )
  }

  // Early return if no app (all hooks already called)
  if (!app) {
    return null
  }

  const handleReload = () => {
    if (!app) return
    if (webviewRef.current) {
      setWebviewLoaded(app.appId, false)
      setIsReady(false)
      webviewRef.current.src = app.url
      setCurrentUrl(app.url)
    }
  }

  const handleOpenDevTools = () => {
    webviewRef.current?.openDevTools()
  }

  return (
    <ShellContainer>
      <ToolbarWrapper>
        <MinimalToolbar
          app={app}
          webviewRef={webviewRef}
          // currentUrl may be null (navigation not yet captured); fallback to app.url when opening externally
          currentUrl={currentUrl}
          onReload={handleReload}
          onOpenDevTools={handleOpenDevTools}
        />
      </ToolbarWrapper>
      <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} appId={app.appId} />
      {!isReady && (
        <LoadingMask>
          <LogoAvatar logo={app.logo} size={60} />
          <BeatLoader color="var(--color-text-2)" size={8} style={{ marginTop: 12 }} />
        </LoadingMask>
      )}
    </ShellContainer>
  )
}
const ShellContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  z-index: 3; /* Above the webviews in the pool */
  pointer-events: none; /* Let lower webviews be interactive by default */
  > * {
    pointer-events: auto;
  }
`

const ToolbarWrapper = styled.div`
  flex-shrink: 0;
`

const LoadingMask = styled.div`
  position: absolute;
  inset: 35px 0 0 0; /* Avoid toolbar height */
  display: flex;
  flex-direction: column; /* Vertical stacking */
  align-items: center;
  justify-content: center;
  background: var(--color-background);
  z-index: 4;
  gap: 12px;
`

const ErrorText = styled.div`
  color: var(--color-text-2);
  font-size: 14px;
`

export default MiniAppPage
