import { loggerService } from '@logger'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import TabsService from '@renderer/services/TabsService'
import { getWebviewLoaded, onWebviewStateChange, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { Avatar } from 'antd'
import { WebviewTag } from 'electron'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

// Tab 模式下新的页面壳，不再直接创建 WebView，而是依赖全局 MinAppTabsPool
import MinimalToolbar from './components/MinimalToolbar'

const logger = loggerService.withContext('MinAppPage')

const MinAppPage: FC = () => {
  const { appId } = useParams<{ appId: string }>()
  const { isTopNavbar } = useNavbarPosition()
  const { openMinappKeepAlive, minAppsCache } = useMinappPopup()
  const { minapps } = useMinapps()
  // openedKeepAliveMinapps 不再需要作为依赖参与 webview 选择，已通过 MutationObserver 动态发现
  // const { openedKeepAliveMinapps } = useRuntime()
  const navigate = useNavigate()

  // Remember the initial navbar position when component mounts
  const initialIsTopNavbar = useRef<boolean>(isTopNavbar)
  const hasRedirected = useRef<boolean>(false)

  // Initialize TabsService with cache reference
  useEffect(() => {
    if (minAppsCache) {
      TabsService.setMinAppsCache(minAppsCache)
    }
  }, [minAppsCache])

  // Debug: track navbar position changes
  useEffect(() => {
    if (initialIsTopNavbar.current !== isTopNavbar) {
      logger.debug(`NavBar position changed from ${initialIsTopNavbar.current} to ${isTopNavbar}`)
    }
  }, [isTopNavbar])

  // Find the app from all available apps
  const app = useMemo(() => {
    if (!appId) return null
    return [...DEFAULT_MIN_APPS, ...minapps].find((app) => app.id === appId)
  }, [appId, minapps])

  useEffect(() => {
    // If app not found, redirect to apps list
    if (!app) {
      navigate('/apps')
      return
    }

    // For sidebar navigation, redirect to apps list and open popup
    // Only check once and only if we haven't already redirected
    if (!initialIsTopNavbar.current && !hasRedirected.current) {
      hasRedirected.current = true
      navigate('/apps')
      // Open popup after navigation
      setTimeout(() => {
        openMinappKeepAlive(app)
      }, 100)
      return
    }

    // For top navbar mode, integrate with cache system
    if (initialIsTopNavbar.current) {
      // 无论是否已在缓存，都调用以确保 currentMinappId 同步到路由切换的新 appId
      openMinappKeepAlive(app)
    }
  }, [app, navigate, openMinappKeepAlive, initialIsTopNavbar])

  // -------------- 新的 Tab Shell 逻辑 --------------
  // 注意：Hooks 必须在任何 return 之前调用，因此提前定义，并在内部判空
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState<boolean>(() => (app ? getWebviewLoaded(app.id) : false))
  const [currentUrl, setCurrentUrl] = useState<string | null>(app?.url ?? null)

  // 获取池中的 webview 元素（避免因为 openedKeepAliveMinapps.length 变化而频繁重跑）
  const webviewCleanupRef = useRef<(() => void) | null>(null)

  const attachWebview = useCallback(() => {
    if (!app) return true // 没有 app 不再继续监控
    const selector = `webview[data-minapp-id="${app.id}"]`
    const el = document.querySelector(selector) as WebviewTag | null
    if (!el) return false

    if (webviewRef.current === el) return true // 已附着

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

    // 先尝试立即附着
    if (attachWebview()) return () => webviewCleanupRef.current?.()

    // 若尚未创建，对 DOM 变更做一次监听（轻量 + 自动断开）
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

  // 事件驱动等待加载完成（移除固定 150ms 轮询）
  useEffect(() => {
    if (!app) return
    if (getWebviewLoaded(app.id)) {
      // 已经加载
      if (!isReady) setIsReady(true)
      return
    }
    let mounted = true
    const unsubscribe = onWebviewStateChange(app.id, (loaded) => {
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

  // 如果条件不满足，提前返回（所有 hooks 已调用）
  if (!app || !initialIsTopNavbar.current) {
    return null
  }

  const handleReload = () => {
    if (!app) return
    if (webviewRef.current) {
      setWebviewLoaded(app.id, false)
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
          // currentUrl 可能为 null（尚未捕获导航），外部打开时会 fallback 到 app.url
          currentUrl={currentUrl}
          onReload={handleReload}
          onOpenDevTools={handleOpenDevTools}
        />
      </ToolbarWrapper>
      {!isReady && (
        <LoadingMask>
          <Avatar src={app.logo} size={60} style={{ border: '1px solid var(--color-border)' }} />
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
  z-index: 3; /* 高于池中的 webview */
  pointer-events: none; /* 让下层 webview 默认可交互 */
  > * {
    pointer-events: auto;
  }
`

const ToolbarWrapper = styled.div`
  flex-shrink: 0;
`

const LoadingMask = styled.div`
  position: absolute;
  inset: 35px 0 0 0; /* 避开 toolbar 高度 */
  display: flex;
  flex-direction: column; /* 垂直堆叠 */
  align-items: center;
  justify-content: center;
  background: var(--color-background);
  z-index: 4;
  gap: 12px;
`

export default MinAppPage
