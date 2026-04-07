import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { useLocation } from '@tanstack/react-router'
import type { WebviewTag } from 'electron'
import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'

/**
 * Mini-app WebView pool for Tab 模式 (顶部导航).
 *
 * 与 Popup 模式相似，但独立存在：
 *  - 仅在 isTopNavbar=true 且访问 /apps 路由时显示
 *  - 保证已打开的 keep-alive 小程序对应的 <webview> 不被卸载，只通过 display 切换
 *  - LRU 淘汰通过 openedKeepAliveMiniApps 变化自动移除 DOM
 *
 * 后续可演进：与 Popup 共享同一实例（方案 B）。
 */
const logger = loggerService.withContext('MiniAppTabsPool')

const MiniAppTabsPool: React.FC = () => {
  const { openedKeepAliveMiniApps, currentMiniAppId } = useMiniApps()
  const { isTopNavbar } = useNavbarPosition()
  const location = useLocation()

  // webview refs（池内部自用，用于控制显示/隐藏）
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())

  // 使用集中工具进行更稳健的路由判断
  const isAppDetail = (() => {
    const pathname = location.pathname
    if (pathname === '/app/miniapp') return false
    if (!pathname.startsWith('/app/miniapp/')) return false
    const parts = pathname.split('/').filter(Boolean) // ['app', 'miniapp', '<id>', ...]
    return parts.length >= 3
  })()
  const shouldShow = isTopNavbar && isAppDetail

  // 组合当前需要渲染的列表（保持顺序即可）
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

  /** 记录导航（暂未外曝 URL 状态，后续可接入全局 URL Map） */
  const handleNavigate = (appid: string, url: string) => {
    logger.debug(`TabPool webview navigate: ${appid} -> ${url}`)
  }

  /** 切换显示状态：仅当前 active 的显示，其余隐藏 */
  useEffect(() => {
    webviewRefs.current.forEach((ref, id) => {
      if (!ref) return
      const active = id === currentMiniAppId && shouldShow
      ref.style.display = active ? 'inline-flex' : 'none'
    })
  }, [currentMiniAppId, shouldShow, apps.length])

  /** 当某个已在 Map 里但不再属于 openedKeepAlive 时，移除引用（React 自身会卸载元素） */
  useEffect(() => {
    // Build Set for O(1) lookups (js-set-map-lookups)
    const activeIds = new Set(apps.map((a) => a.appId))
    for (const id of webviewRefs.current.keys()) {
      if (!activeIds.has(id)) {
        webviewRefs.current.delete(id)
        if (getWebviewLoaded(id)) {
          setWebviewLoaded(id, false)
        }
      }
    }
  }, [apps])

  // 不显示时直接 hidden，避免闪烁；仍然保留 DOM 做保活
  const toolbarHeight = 35 // 与 MinimalToolbar 高度保持一致

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
  /* display 控制在内部 webview 元素上做，这里保持结构稳定 */
  pointer-events: ${(props) => (props.$active ? 'auto' : 'none')};
`

export default MiniAppTabsPool
