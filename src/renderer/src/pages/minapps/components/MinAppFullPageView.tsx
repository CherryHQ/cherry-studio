import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MinApp/WebviewContainer'
import { useSettings } from '@renderer/hooks/useSettings'
import { MinAppType } from '@renderer/types'
import { getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import { Avatar } from 'antd'
import { WebviewTag } from 'electron'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import MinimalToolbar from './MinimalToolbar'

const logger = loggerService.withContext('MinAppFullPageView')

interface Props {
  app: MinAppType
}

const MinAppFullPageView: FC<Props> = ({ app }) => {
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const { minappsOpenLinkExternal } = useSettings()

  // Debug: log isReady state changes
  useEffect(() => {
    logger.debug(`isReady state changed to: ${isReady}`)
  }, [isReady])

  // Initialize when app changes - smart loading state detection using global state
  useEffect(() => {
    setCurrentUrl(app.url)

    // Check if this WebView has been loaded before using global state manager
    if (getWebviewLoaded(app.id)) {
      logger.debug(`App ${app.id} already loaded before, setting ready immediately`)
      setIsReady(true)
      return // No cleanup needed for immediate ready state
    } else {
      logger.debug(`App ${app.id} not loaded before, showing loading state`)
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
        window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
      }

      // Mark this WebView as loaded for future use in global state
      setWebviewLoaded(appId, true)

      // Use small delay like MinappPopupContainer (100ms) to ensure content is visible
      if (appId === app.id) {
        setTimeout(() => {
          logger.debug(`WebView loaded callback: setting isReady to true for ${appId}`)
          setIsReady(true)
        }, 100)
      }
    },
    [minappsOpenLinkExternal, app.id]
  )

  const handleWebviewNavigate = useCallback((_appId: string, url: string) => {
    logger.debug(`URL changed: ${url}`)
    setCurrentUrl(url)
  }, [])

  const handleReload = useCallback(() => {
    if (webviewRef.current) {
      // Clear the loaded state for this app since we're reloading using global state
      setWebviewLoaded(app.id, false)
      setIsReady(false) // Set loading state when reloading
      webviewRef.current.src = app.url
    }
  }, [app.url, app.id])

  const handleOpenDevTools = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.openDevTools()
    }
  }, [])

  return (
    <Container>
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        currentUrl={currentUrl}
        onReload={handleReload}
        onOpenDevTools={handleOpenDevTools}
      />

      <WebviewArea>
        {!isReady && (
          <LoadingMask>
            <LoadingOverlay>
              <Avatar src={app.logo} size={60} style={{ border: '1px solid var(--color-border)' }} />
              <BeatLoader color="var(--color-text-2)" size={8} style={{ marginTop: 12 }} />
            </LoadingOverlay>
          </LoadingMask>
        )}

        <WebviewContainer
          key={app.id}
          appid={app.id}
          url={app.url}
          onSetRefCallback={handleWebviewSetRef}
          onLoadedCallback={handleWebviewLoaded}
          onNavigateCallback={handleWebviewNavigate}
        />
      </WebviewArea>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const WebviewArea = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: var(--color-background);
  min-height: 0; /* Ensure flex child can shrink */
`

const LoadingMask = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-background);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
`

const LoadingOverlay = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
`

export default MinAppFullPageView
