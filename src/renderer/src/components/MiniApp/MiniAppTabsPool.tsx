import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { useLocation } from '@tanstack/react-router'
import type { WebviewTag } from 'electron'
import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'

/**
 * Global mini-app WebView pool — keeps `<webview>` elements alive across
 * route changes for opened keep-alive miniapps. Mounted once at the AppShell
 * level so both sidebar and top-navbar modes share the same pool.
 *
 * Visibility:
 *  - The active app's webview is shown (display: inline-flex) when on the
 *    `/app/mini-app/<id>` detail route
 *  - All other webviews stay mounted but display:none (keep-alive)
 */
const logger = loggerService.withContext('MiniAppTabsPool')

const MiniAppTabsPool: React.FC = () => {
  const { openedKeepAliveMiniApps, currentMiniAppId } = useMiniApps()
  const location = useLocation()

  // webview refs (pool-internal, used to control show/hide)
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())

  // Show only when on a specific miniapp detail route.
  const shouldShow = (() => {
    const pathname = location.pathname
    if (pathname === '/app/mini-app') return false
    if (!pathname.startsWith('/app/mini-app/')) return false
    const parts = pathname.split('/').filter(Boolean) // ['app', 'mini-app', '<id>', ...]
    return parts.length >= 3
  })()

  // Combine the list to render (preserve order)
  const apps = openedKeepAliveMiniApps

  /** 设置 ref 回调 */
  const handleSetRef = (appid: string, el: WebviewTag | null) => {
    if (el) {
      webviewRefs.current.set(appid, el)
    } else {
      webviewRefs.current.delete(appid)
    }
  }

  /** WebView 加载完成回调 */
  const handleLoaded = (appid: string) => {
    setWebviewLoaded(appid, true)
    logger.debug(`TabPool webview loaded: ${appid}`)
  }

  /** Record navigation (URL state not yet exposed; can integrate with global URL Map later) */
  const handleNavigate = (appid: string, url: string) => {
    logger.debug(`TabPool webview navigate: ${appid} -> ${url}`)
  }

  /** Toggle display: only the active one is visible, the rest are hidden */
  useEffect(() => {
    webviewRefs.current.forEach((ref, id) => {
      if (!ref) return
      const active = id === currentMiniAppId && shouldShow
      ref.style.display = active ? 'inline-flex' : 'none'
    })
  }, [currentMiniAppId, shouldShow, apps.length])

  /** When an entry is in the Map but no longer in openedKeepAlive, remove the ref (React unmounts the element itself) */
  useEffect(() => {
    // Build Set for O(1) lookups (js-set-map-lookups)
    const activeIds = new Set<string>(apps.map((a) => a.appId))
    for (const id of webviewRefs.current.keys()) {
      if (!activeIds.has(id)) {
        webviewRefs.current.delete(id)
        if (getWebviewLoaded(id)) {
          setWebviewLoaded(id, false)
        }
      }
    }
  }, [apps])

  // Hide directly when not shown to avoid flicker; keep DOM for keep-alive
  const toolbarHeight = 35 // Match MinimalToolbar height

  return (
    <PoolContainer
      style={
        shouldShow
          ? {
              visibility: 'visible',
              top: toolbarHeight,
              height: `calc(100% - ${toolbarHeight}px)`
            }
          : { visibility: 'hidden' }
      }
      data-miniapp-tabs-pool
      aria-hidden={!shouldShow}>
      {apps.map((app) => (
        <WebviewWrapper key={app.appId} $active={app.appId === currentMiniAppId}>
          <WebviewContainer
            appid={app.appId}
            url={app.url}
            onSetRefCallback={handleSetRef}
            onLoadedCallback={handleLoaded}
            onNavigateCallback={handleNavigate}
          />
        </WebviewWrapper>
      ))}
    </PoolContainer>
  )
}

const PoolContainer = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  /* top 在运行时通过 style 注入 (toolbarHeight) */
  width: 100%;
  overflow: hidden;
  border-radius: 0 0 8px 8px;
  z-index: 1;
  pointer-events: none;
  & webview {
    pointer-events: auto;
  }
`

const WebviewWrapper = styled.div<{ $active: boolean }>`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* display is controlled on the inner webview element; keep the wrapper structure stable */
  pointer-events: ${(props) => (props.$active ? 'auto' : 'none')};
`

export default MiniAppTabsPool
