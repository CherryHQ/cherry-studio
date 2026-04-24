import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { tabsService } from '@renderer/services/TabsService'
import { getWebviewLoaded, onWebviewStateChange, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { MiniApp } from '@shared/data/types/miniApp'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

// Tab mode page shell — relies on the global MiniAppTabsPool instead of creating WebViews directly
import MinimalToolbar from './components/MinimalToolbar'
import WebviewSearch from './components/WebviewSearch'

const logger = loggerService.withContext('MiniAppPage')

const MiniAppPage: FC = () => {
  const { appId } = useParams({ strict: false })
  const { isTopNavbar } = useNavbarPosition()
  const { openMiniAppKeepAlive, miniAppsCache } = useMiniAppPopup()
  const { allApps, isLoading, error } = useMiniApps()
  const navigate = useNavigate()

  // Remember the initial navbar position when component mounts
  const initialIsTopNavbar = useRef<boolean>(isTopNavbar)
  const hasRedirected = useRef<boolean>(false)

  // Initialize TabsService with cache reference
  useEffect(() => {
    if (miniAppsCache) {
      tabsService.setMiniAppsCache(miniAppsCache)
    }
  }, [miniAppsCache])

  // Debug: track navbar position changes
  useEffect(() => {
    if (initialIsTopNavbar.current !== isTopNavbar) {
      logger.debug(`NavBar position changed from ${initialIsTopNavbar.current} to ${isTopNavbar}`)
    }
  }, [isTopNavbar])

  // Find the app from all available apps (including cached ones)
  const app = useMemo((): MiniApp | null => {
    if (!appId) return null

    // First try to find in all apps from DataApi
    const found = allApps.find((a) => a.appId === appId)

    // If not found and we have cache, try to find in cache (for temporary apps)
    if (!found && miniAppsCache) {
      return miniAppsCache.get(appId) ?? null
    }

    if (!found) return null

    return found
  }, [appId, allApps, miniAppsCache])

  useEffect(() => {
    // While data is still loading, don't redirect — app is null because allApps is empty
    if (isLoading) return

    // If DataApi returned an error, log and redirect
    if (error) {
      logger.error('Failed to load mini apps', error instanceof DataApiError ? error : undefined)
      void navigate({ to: '/app/mini-app' })
      return
    }

    // If app not found after loading completes, redirect to apps list
    if (!app) {
      void navigate({ to: '/app/mini-app' })
      return
    }

    // For sidebar navigation, redirect to apps list and open popup
    // Only check once and only if we haven't already redirected
    if (!initialIsTopNavbar.current && !hasRedirected.current) {
      hasRedirected.current = true
      void navigate({ to: '/app/mini-app' })
      // Open popup after navigation
      setTimeout(() => {
        openMiniAppKeepAlive(app)
      }, 100)
      return
    }

    // For top navbar mode, integrate with cache system
    if (initialIsTopNavbar.current) {
      // Always call to ensure currentMiniAppId stays in sync with the route-changed appId
      openMiniAppKeepAlive(app)
    }
  }, [app, navigate, openMiniAppKeepAlive, initialIsTopNavbar, isLoading, error])

  // -------------- Tab Shell logic --------------
  // Hooks must be called before any return, so define them early with null-checks inside
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState<boolean>(() => (app ? getWebviewLoaded(app.appId) : false))
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
          <ErrorText>{isNotFound ? 'App not found' : 'Failed to load app'}</ErrorText>
        </LoadingMask>
      </ShellContainer>
    )
  }

  // Early return if no app or not in top navbar mode (all hooks already called)
  if (!app || !initialIsTopNavbar.current) {
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
