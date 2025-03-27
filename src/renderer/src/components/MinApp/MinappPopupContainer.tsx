import {
  CloseOutlined,
  CodeOutlined,
  ExportOutlined,
  MinusOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { isMac, isWindows } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useBridge } from '@renderer/hooks/useBridge'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { MinAppType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { Avatar, Drawer, Tooltip } from 'antd'
import { WebviewTag } from 'electron'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import WebviewContainer from './WebviewContainer'

interface AppExtraInfo {
  canPinned: boolean
  isPinned: boolean
  canOpenExternalLink: boolean
}

type AppInfo = MinAppType & AppExtraInfo

/** The main container for MinApp popup */
const MinappPopupContainer: React.FC = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp, currentMinappId, minappShow } = useRuntime()
  const { closeMinapp, hideMinappPopup } = useMinappPopup()
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()

  /** control the drawer open or close */
  const [isPopupShow, setIsPopupShow] = useState(true)
  /** whether the current minapp is ready */
  const [isReady, setIsReady] = useState(false)

  /** store the last minapp id and show status */
  const lastMinappId = useRef<string | null>(null)
  const lastMinappShow = useRef<boolean>(false)

  /** store the webview refs, one of the key to make them keepalive */
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())
  /** indicate whether the webview has loaded  */
  const webviewLoadedRefs = useRef<Map<string, boolean>>(new Map())

  const isInDevelopment = process.env.NODE_ENV === 'development'

  useBridge()

  /** set the popup display status */
  useEffect(() => {
    if (minappShow) {
      setIsPopupShow(true)

      if (webviewLoadedRefs.current.get(currentMinappId)) {
        setIsReady(true)
        /** the case that open the minapp from sidebar */
      } else if (lastMinappId.current !== currentMinappId && lastMinappShow.current === minappShow) {
        setIsReady(false)
      }
    } else {
      setIsPopupShow(false)
      setIsReady(false)
    }

    return () => {
      /** renew the last minapp id and show status */
      lastMinappId.current = currentMinappId
      lastMinappShow.current = minappShow
    }
  }, [minappShow, currentMinappId])

  useEffect(() => {
    if (!webviewRefs.current) return

    /** set the webview display status
     * DO NOT use the state to set the display status,
     * to AVOID the re-render of the webview container
     */
    webviewRefs.current.forEach((webviewRef, appid) => {
      if (!webviewRef) return
      webviewRef.style.display = appid === currentMinappId ? 'inline-flex' : 'none'
    })

    //delete the extra webviewLoadedRefs
    webviewLoadedRefs.current.forEach((_, appid) => {
      if (!webviewRefs.current.has(appid)) {
        webviewLoadedRefs.current.delete(appid)
      }
    })
  }, [currentMinappId])

  /** combine the openedKeepAliveMinapps and openedOneOffMinapp */
  const combinedApps = useMemo(() => {
    return [...openedKeepAliveMinapps, ...(openedOneOffMinapp ? [openedOneOffMinapp] : [])]
  }, [openedKeepAliveMinapps, openedOneOffMinapp])

  /** get the extra info of the apps */
  const appsExtraInfo = useMemo(() => {
    return combinedApps.reduce(
      (acc, app) => ({
        ...acc,
        [app.id]: {
          canPinned: DEFAULT_MIN_APPS.some((item) => item.id === app.id),
          isPinned: pinned.some((item) => item.id === app.id),
          canOpenExternalLink: app.url.startsWith('http://') || app.url.startsWith('https://')
        }
      }),
      {} as Record<string, AppExtraInfo>
    )
  }, [combinedApps, pinned])

  /** get the current app info with extra info */
  let currentAppInfo: AppInfo | null = null
  if (currentMinappId) {
    const currentApp = combinedApps.find((item) => item.id === currentMinappId) as MinAppType
    currentAppInfo = { ...currentApp, ...appsExtraInfo[currentApp.id] }
  }

  /** will close the popup and delete the webview */
  const handlePopupClose = async (appid: string) => {
    setIsPopupShow(false)
    await delay(0.3)
    webviewLoadedRefs.current.delete(appid)
    closeMinapp(appid)
  }

  /** will hide the popup and remain the webviews */
  const handlePopupMinimize = async () => {
    setIsPopupShow(false)
    await delay(0.3)
    hideMinappPopup()
  }

  /** the callback function to set the webviews ref */
  const handleWebviewSetRef = (appid: string, element: WebviewTag | null) => {
    webviewRefs.current.set(appid, element)

    if (!webviewRefs.current.has(appid)) {
      webviewRefs.current.set(appid, null)
      return
    }

    if (element) {
      webviewRefs.current.set(appid, element)
    } else {
      webviewRefs.current.delete(appid)
    }
  }

  /** the callback function to set the webviews loaded indicator */
  const handleWebviewLoaded = (appid: string) => {
    webviewLoadedRefs.current.set(appid, true)
    if (appid == currentMinappId) {
      setTimeout(() => setIsReady(true), 200)
    }
  }

  /** will open the devtools of the minapp */
  const handleOpenDevTools = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      webview.openDevTools()
    }
  }

  /** only reload the original url */
  const handleReload = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      const url = combinedApps.find((item) => item.id === appid)?.url
      if (url) {
        webview.src = url
      }
    }
  }

  /** only open the current url */
  const handleOpenLink = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      window.api.openWebsite(webview.getURL())
    }
  }

  /** toggle the pin status of the minapp */
  const handleTogglePin = (appid: string) => {
    const app = combinedApps.find((item) => item.id === appid)
    if (!app) return

    const newPinned = appsExtraInfo[appid].isPinned ? pinned.filter((item) => item.id !== appid) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }

  /** Title bar of the popup */
  const Title = ({ appInfo }: { appInfo: AppInfo | null }) => {
    if (!appInfo) return null
    return (
      <TitleContainer style={{ justifyContent: 'space-between' }}>
        <TitleText>{appInfo.name}</TitleText>
        <ButtonsGroup className={isWindows ? 'windows' : ''}>
          <Tooltip title={t('minapp.popup.refresh')} mouseEnterDelay={0.8} placement="bottom">
            <Button onClick={() => handleReload(appInfo.id)}>
              <ReloadOutlined />
            </Button>
          </Tooltip>
          {appInfo.canPinned && (
            <Tooltip
              title={appInfo.isPinned ? t('minapp.sidebar.remove.title') : t('minapp.sidebar.add.title')}
              mouseEnterDelay={0.8}
              placement="bottom">
              <Button onClick={() => handleTogglePin(appInfo.id)} className={appInfo.isPinned ? 'pinned' : ''}>
                <PushpinOutlined style={{ fontSize: 16 }} />
              </Button>
            </Tooltip>
          )}
          {appInfo.canOpenExternalLink && (
            <Tooltip title={t('minapp.popup.openExternal')} mouseEnterDelay={0.8} placement="bottom">
              <Button onClick={() => handleOpenLink(appInfo.id)}>
                <ExportOutlined />
              </Button>
            </Tooltip>
          )}
          {isInDevelopment && (
            <Tooltip title={t('minapp.popup.devtools')} mouseEnterDelay={0.8} placement="bottom">
              <Button onClick={() => handleOpenDevTools(appInfo.id)}>
                <CodeOutlined />
              </Button>
            </Tooltip>
          )}
          <Tooltip title={t('minapp.popup.minimize')} mouseEnterDelay={0.8} placement="bottom">
            <Button onClick={() => handlePopupMinimize()}>
              <MinusOutlined />
            </Button>
          </Tooltip>
          <Tooltip title={t('minapp.popup.close')} mouseEnterDelay={0.8} placement="bottom">
            <Button onClick={() => handlePopupClose(appInfo.id)}>
              <CloseOutlined />
            </Button>
          </Tooltip>
        </ButtonsGroup>
      </TitleContainer>
    )
  }

  /** group the webview containers with Memo, one of the key to make them keepalive */
  const WebviewContainerGroup = useMemo(() => {
    return combinedApps.map((app) => (
      <WebviewContainer
        key={app.id}
        appid={app.id}
        url={app.url}
        onSetRefCallback={handleWebviewSetRef}
        onLoadedCallback={handleWebviewLoaded}
      />
    ))

    // because the combinedApps is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedApps])

  return (
    <Drawer
      title={<Title appInfo={currentAppInfo} />}
      placement="bottom"
      onClose={handlePopupMinimize}
      open={isPopupShow}
      destroyOnClose={false}
      mask={false}
      rootClassName="minapp-drawer"
      maskClassName="minapp-mask"
      height={'100%'}
      maskClosable={false}
      closeIcon={null}
      style={{ marginLeft: 'var(--sidebar-width)' }}>
      {!isReady && (
        <EmptyView>
          <Avatar
            src={currentAppInfo?.logo}
            size={80}
            style={{ border: '1px solid var(--color-border)', marginTop: -150 }}
          />
          <BeatLoader color="var(--color-text-2)" size="10px" style={{ marginTop: 15 }} />
        </EmptyView>
      )}
      {WebviewContainerGroup}
    </Drawer>
  )
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
  background-color: transparent;
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

export default MinappPopupContainer
