import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import WebviewContainer from '@renderer/components/MiniApp/WebviewContainer'
import { getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { WebviewTag } from 'electron'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'

import MinimalToolbar from './MinimalToolbar'

const logger = loggerService.withContext('MiniAppFullPageView')

interface Props {
  app: MiniApp
}

const MiniAppFullPageView: FC<Props> = ({ app }) => {
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [openLinkExternal] = usePreference('feature.mini_app.open_link_external')

  // Debug: log isReady state changes
  useEffect(() => {
    logger.debug(`isReady state changed to: ${isReady}`)
  }, [isReady])

  // Initialize when app changes - smart loading state detection using global state
  useEffect(() => {
    setCurrentUrl(app.url)

    // Check if this WebView has been loaded before using global state manager
    if (getWebviewLoaded(app.appId)) {
      logger.debug(`App ${app.appId} already loaded before, setting ready immediately`)
      setIsReady(true)
      return // No cleanup needed for immediate ready state
    } else {
      logger.debug(`App ${app.appId} not loaded before, showing loading state`)
      setIsReady(false)

      // Backup timer logic removed as requested—loading animation will show indefinitely if needed.
      // (See version control history for previous implementation.)
    }
  }, [app])

  const handleWebviewSetRef = useCallback((_appId: string, element: WebviewTag | null) => {
    webviewRef.current = element
    if (element) {
      logger.debug('WebView element set')
    }
  }, [])

  const handleWebviewLoaded = useCallback(
    (appId: string) => {
      logger.debug(`WebView loaded for app: ${appId}`)
      const webviewId = webviewRef.current?.getWebContentsId()
      if (webviewId) {
        void window.api.webview.setOpenLinkExternal(webviewId, openLinkExternal)
      }

      // Mark this WebView as loaded for future use in global state
      setWebviewLoaded(appId, true)

      // Use small delay like MiniAppPopupContainer (100ms) to ensure content is visible
      if (appId === app.appId) {
        setTimeout(() => {
          logger.debug(`WebView loaded callback: setting isReady to true for ${appId}`)
          setIsReady(true)
        }, 100)
      }
    },
    [openLinkExternal, app.appId]
  )

  const handleWebviewNavigate = useCallback((_appId: string, url: string) => {
    logger.debug(`URL changed: ${url}`)
    setCurrentUrl(url)
  }, [])

  const handleReload = useCallback(() => {
    if (webviewRef.current) {
      // Clear the loaded state for this app since we're reloading using global state
      setWebviewLoaded(app.appId, false)
      setIsReady(false) // Set loading state when reloading
      webviewRef.current.src = app.url
    }
  }, [app.url, app.appId])

  const handleOpenDevTools = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.openDevTools()
    }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={currentUrl}
        onReload={handleReload}
        onOpenDevTools={handleOpenDevTools}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {!isReady && (
          <div className="absolute inset-0 z-100 flex items-center justify-center bg-background">
            <div className="pointer-events-none flex flex-col items-center">
              <LogoAvatar logo={app.logo} size={60} />
              <BeatLoader color="var(--color-text-2)" size={8} style={{ marginTop: 12 }} />
            </div>
          </div>
        )}

        <WebviewContainer
          key={app.appId}
          appid={app.appId}
          url={app.url}
          onSetRefCallback={handleWebviewSetRef}
          onLoadedCallback={handleWebviewLoaded}
          onNavigateCallback={handleWebviewNavigate}
        />
      </div>
    </div>
  )
}

export default MiniAppFullPageView
