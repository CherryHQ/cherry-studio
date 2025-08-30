import { loggerService } from '@logger'
import WebviewContainer from '@renderer/components/MinApp/WebviewContainer'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTimer } from '@renderer/hooks/useTimer'
import { MinAppType } from '@renderer/types'
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
  const { setTimeoutTimer } = useTimer()

  // Initialize when app changes
  useEffect(() => {
    setCurrentUrl(app.url)
    setIsReady(false)
  }, [app])

  const handleWebviewSetRef = useCallback((_appId: string, element: WebviewTag | null) => {
    webviewRef.current = element
  }, [])

  const handleWebviewLoaded = useCallback(
    (/* _appId: string */) => {
      const webviewId = webviewRef.current?.getWebContentsId()
      if (webviewId) {
        window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
      }
      setTimeoutTimer('handleWebviewLoaded', () => setIsReady(true), 200)
    },
    [minappsOpenLinkExternal, setTimeoutTimer]
  )

  const handleWebviewNavigate = useCallback((_appId: string, url: string) => {
    logger.debug(`URL changed: ${url}`)
    setCurrentUrl(url)
  }, [])

  const handleReload = useCallback(() => {
    if (webviewRef.current) {
      webviewRef.current.src = app.url
    }
  }, [app.url])

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
          <LoadingOverlay>
            <Avatar src={app.logo} size={60} style={{ border: '1px solid var(--color-border)' }} />
            <BeatLoader color="var(--color-text-2)" size={8} style={{ marginTop: 12 }} />
          </LoadingOverlay>
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
`

const LoadingOverlay = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 10;
  pointer-events: none;
`

export default MinAppFullPageView
