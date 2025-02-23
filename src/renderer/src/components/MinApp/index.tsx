/* eslint-disable react/no-unknown-property */
import { CloseOutlined, CodeOutlined, ExportOutlined, PushpinOutlined, ReloadOutlined } from '@ant-design/icons'
import { isMac, isWindows } from '@renderer/config/constant'
import { AppLogo } from '@renderer/config/env'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useBridge } from '@renderer/hooks/useBridge'
import { useMinapps } from '@renderer/hooks/useMinapps'
import store from '@renderer/store'
import { setMinappShow } from '@renderer/store/runtime'
import { MinAppType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { Avatar, Drawer } from 'antd'
import { WebviewTag } from 'electron'
import { useEffect, useRef, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import { TopView } from '../TopView'

interface Props {
  app: MinAppType
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ app, resolve }) => {
  const { pinned, updatePinnedMinapps } = useMinapps()
  const isPinned = pinned.some((p) => p.id === app.id)
  const [open, setOpen] = useState(true)
  const [opened, setOpened] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const webviewRef = useRef<WebviewTag | null>(null)

  useBridge()

  const canOpenExternalLink = app.url.startsWith('http://') || app.url.startsWith('https://')
  const canPinned = DEFAULT_MIN_APPS.some((i) => i.id === app?.id)

  const onClose = async (_delay = 0.3) => {
    setOpen(false)
    await delay(_delay)
    resolve({})
  }

  MinApp.onClose = onClose
  const openDevTools = () => {
    if (webviewRef.current) {
      webviewRef.current.openDevTools()
    }
  }
  const onReload = () => {
    if (webviewRef.current) {
      webviewRef.current.src = app.url
    }
  }

  const onOpenLink = () => {
    if (webviewRef.current) {
      const currentUrl = webviewRef.current.getURL()
      window.api.openWebsite(currentUrl)
    }
  }

  const onTogglePin = () => {
    const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }
  const isInDevelopment = process.env.NODE_ENV === 'development'
  const Title = () => {
    return (
      <TitleContainer style={{ justifyContent: 'space-between' }}>
        <TitleText>{app.name}</TitleText>
        <ButtonsGroup className={isWindows ? 'windows' : ''}>
          <Button onClick={onReload}>
            <ReloadOutlined />
          </Button>
          {canPinned && (
            <Button onClick={onTogglePin} className={isPinned ? 'pinned' : ''}>
              <PushpinOutlined style={{ fontSize: 16 }} />
            </Button>
          )}
          {canOpenExternalLink && (
            <Button onClick={onOpenLink}>
              <ExportOutlined />
            </Button>
          )}
          {isInDevelopment && (
            <Button onClick={openDevTools}>
              <CodeOutlined />
            </Button>
          )}
          <Button onClick={() => onClose()}>
            <CloseOutlined />
          </Button>
        </ButtonsGroup>
      </TitleContainer>
    )
  }

  useEffect(() => {
    const webview = webviewRef.current

    if (webview) {
      const handleNewWindow = (event: any) => {
        event.preventDefault()
        if (webview.loadURL) {
          webview.loadURL(event.url)
        }
      }

      const onLoaded = () => setIsReady(true)

      webview.addEventListener('new-window', handleNewWindow)
      webview.addEventListener('did-finish-load', onLoaded)

      return () => {
        webview.removeEventListener('new-window', handleNewWindow)
        webview.removeEventListener('did-finish-load', onLoaded)
      }
    }

    return () => {}
  }, [opened])

  useEffect(() => {
    setTimeout(() => setOpened(true), 350)
  }, [])

  return (
    <Drawer
      title={<Title />}
      placement="bottom"
      onClose={() => onClose()}
      open={open}
      mask={true}
      rootClassName="minapp-drawer"
      maskClassName="minapp-mask"
      height={'100%'}
      maskClosable={false}
      closeIcon={null}
      style={{ marginLeft: 'var(--sidebar-width)' }}>
      {!isReady && (
        <EmptyView>
          <Avatar src={app.logo} size={80} style={{ border: '1px solid var(--color-border)', marginTop: -150 }} />
          <BeatLoader color="var(--color-text-2)" size="10" style={{ marginTop: 15 }} />
        </EmptyView>
      )}
      {opened && (
        <webview
          src={app.url}
          ref={webviewRef}
          style={WebviewStyle}
          allowpopups={'true' as any}
          partition="persist:webview"
        />
      )}
    </Drawer>
  )
}

const WebviewStyle: React.CSSProperties = {
  width: 'calc(100vw - var(--sidebar-width))',
  height: 'calc(100vh - var(--navbar-height))',
  backgroundColor: 'white',
  display: 'inline-flex'
}

const TitleContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-left: ${isMac ? '20px' : '10px'};
  padding-right: 10px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`

const TitleText = styled.div`
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-1);
  margin-right: 10px;
  user-select: none;
`

const ButtonsGroup = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  -webkit-app-region: no-drag;
  &.windows {
    margin-right: ${isWindows ? '130px' : 0};
    background-color: var(--color-background-mute);
    border-radius: 50px;
    padding: 0 3px;
    overflow: hidden;
  }
`

const Button = styled.div`
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  font-size: 14px;
  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-background-mute);
  }
  &.pinned {
    color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
`

const EmptyView = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background-color: var(--color-background);
`

export default class MinApp {
  static topviewId = 0
  static onClose = () => {}
  static app: MinAppType | null = null

  static async start(app: MinAppType) {
    if (app?.id && MinApp.app?.id === app?.id) {
      return
    }

    if (MinApp.app) {
      // @ts-ignore delay params
      await MinApp.onClose(0)
      await delay(0)
    }

    if (!app.logo) {
      app.logo = AppLogo
    }

    MinApp.app = app
    store.dispatch(setMinappShow(true))

    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          app={app}
          resolve={(v) => {
            resolve(v)
            this.close()
          }}
        />,
        'MinApp'
      )
    })
  }

  static close() {
    TopView.hide('MinApp')
    store.dispatch(setMinappShow(false))
    MinApp.app = null
    MinApp.onClose = () => {}
  }
}
