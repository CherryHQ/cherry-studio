import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  ExportOutlined,
  LinkOutlined,
  MinusOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Button, Drawer, DrawerContentMinimal, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { LogoAvatar } from '@renderer/components/Icons'
import WindowControls from '@renderer/components/WindowControls'
import { isDev, isLinux, isMac, isWin } from '@renderer/config/constant'
import { useBridge } from '@renderer/hooks/useBridge'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useTimer } from '@renderer/hooks/useTimer'
import { delay } from '@renderer/utils'
import { clearWebviewState, getWebviewLoaded, setWebviewLoaded } from '@renderer/utils/webviewStateManager'
import type { MiniApp } from '@shared/data/types/miniapp'
import { Alert } from 'antd'
import type { WebviewTag } from 'electron'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import WebviewContainer from './WebviewContainer'

const logger = loggerService.withContext('MinappPopupContainer')

interface AppExtraInfo {
  canPinned: boolean
  isPinned: boolean
  canOpenExternalLink: boolean
}

type AppInfo = MiniApp & AppExtraInfo

// Hoist static patterns to module level (js-hoist-regexp)
const GOOGLE_LOGIN_PATTERNS = [
  'accounts.google.com',
  'signin/oauth',
  'auth/google',
  'login/google',
  'sign-in/google',
  'google.com/signin',
  'gsi/client'
]

/** Google login tip component */
const GoogleLoginTip = ({
  isReady,
  currentUrl,
  currentAppId
}: {
  appId?: string | null
  isReady: boolean
  currentUrl: string | null
  currentAppId: string | null
}) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const { openMinappById } = useMinappPopup()

  // 判断当前URL是否涉及Google登录
  const needsGoogleLogin = useMemo(() => {
    // 如果当前已经在Google小程序中，不需要显示提示
    if (currentAppId === 'google') return false

    if (!currentUrl) return false

    const lowerUrl = currentUrl.toLowerCase()
    return GOOGLE_LOGIN_PATTERNS.some((pattern) => lowerUrl.includes(pattern))
  }, [currentUrl, currentAppId])

  // 在URL更新时检查是否需要显示提示
  useEffect(() => {
    let showTimer: NodeJS.Timeout | null = null
    let hideTimer: NodeJS.Timeout | null = null

    // 如果是Google登录相关URL且小程序已加载完成，则延迟显示提示
    if (needsGoogleLogin && isReady) {
      showTimer = setTimeout(() => {
        setVisible(true)
        hideTimer = setTimeout(() => {
          setVisible(false)
        }, 30000)
      }, 500)
    } else {
      setVisible(false)
    }

    return () => {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [needsGoogleLogin, isReady, currentUrl])

  // 处理关闭提示
  const handleClose = () => {
    setVisible(false)
  }

  // 跳转到Google小程序
  const openGoogleMinApp = () => {
    // 使用openMinappById方法打开Google小程序
    openMinappById('google', true)
    // 关闭提示
    setVisible(false)
  }

  // 只在需要Google登录时显示提示
  if (!needsGoogleLogin || !visible) return null

  // 使用直接的消息文本
  const message = t('miniwindow.alert.google_login')

  return (
    <Alert
      message={message}
      type="warning"
      showIcon
      closable
      banner
      onClose={handleClose}
      action={
        <Button color="primary" size="sm" onClick={openGoogleMinApp}>
          {t('common.open')} Google
        </Button>
      }
      style={{ zIndex: 10, animation: 'fadeIn 0.3s ease-in-out' }}
    />
  )
}

/** Title bar of the popup — extracted to module level (rerender-no-inline-components) */
const TitleBar = ({
  appInfo,
  url,
  backgroundColor,
  isTopNavbar,
  canMinimize,
  minappsOpenLinkExternal,
  onGoBack,
  onGoForward,
  onReload,
  onTogglePin,
  onToggleOpenExternal,
  onOpenDevTools,
  onMinimize,
  onClose,
  onOpenLink
}: {
  appInfo: AppInfo | null
  url: string | null
  backgroundColor: string
  isTopNavbar: boolean
  canMinimize: boolean
  minappsOpenLinkExternal: boolean
  onGoBack: (appId: string) => void
  onGoForward: (appId: string) => void
  onReload: (appId: string) => void
  onTogglePin: (appId: string) => void
  onToggleOpenExternal: () => void
  onOpenDevTools: (appId: string) => void
  onMinimize: () => void
  onClose: (appId: string) => void
  onOpenLink: (url: string) => void
}) => {
  const { t } = useTranslation()

  if (!appInfo) return null

  const handleCopyUrl = (event: React.MouseEvent, copyUrl: string) => {
    event.preventDefault()
    navigator.clipboard
      .writeText(copyUrl)
      .then(() => {
        window.toast.success('URL ' + t('message.copy.success'))
      })
      .catch(() => {
        window.toast.error('URL ' + t('message.copy.failed'))
      })
  }

  return (
    <TitleContainer style={{ backgroundColor }}>
      <Tooltip
        placement="right-end"
        className="max-w-100"
        classNames={{ placeholder: 'contents' }}
        content={
          <TitleTextTooltip>
            {url ?? appInfo.url} <br />
            <CopyOutlined className="icon-copy" />
            {t('minapp.popup.rightclick_copyurl')}
          </TitleTextTooltip>
        }>
        <TitleText onContextMenu={(e) => handleCopyUrl(e, url ?? appInfo.url)}>{appInfo.name}</TitleText>
      </Tooltip>
      {appInfo.canOpenExternalLink && (
        <Tooltip
          placement="bottom"
          classNames={{ placeholder: 'contents' }}
          content={t('minapp.popup.openExternal')}
          delay={800}>
          <TitleButton onClick={() => onOpenLink(url ?? appInfo.url)}>
            <ExportOutlined />
          </TitleButton>
        </Tooltip>
      )}
      <Spacer />
      <ButtonsGroup
        className={isWin || isLinux ? 'windows' : ''}
        style={{ marginRight: isWin || isLinux ? '140px' : 0 }}
        isTopNavbar={isTopNavbar}>
        <Tooltip
          placement="bottom"
          classNames={{ placeholder: 'contents' }}
          content={t('minapp.popup.goBack')}
          delay={800}>
          <TitleButton onClick={() => onGoBack(appInfo.appId)}>
            <ArrowLeftOutlined />
          </TitleButton>
        </Tooltip>
        <Tooltip
          placement="bottom"
          classNames={{ placeholder: 'contents' }}
          content={t('minapp.popup.goForward')}
          delay={800}>
          <TitleButton onClick={() => onGoForward(appInfo.appId)}>
            <ArrowRightOutlined />
          </TitleButton>
        </Tooltip>
        <Tooltip
          placement="bottom"
          classNames={{ placeholder: 'contents' }}
          content={t('minapp.popup.refresh')}
          delay={800}>
          <TitleButton onClick={() => onReload(appInfo.appId)}>
            <ReloadOutlined />
          </TitleButton>
        </Tooltip>
        {appInfo.canPinned && (
          <Tooltip
            classNames={{ placeholder: 'contents' }}
            content={
              appInfo.isPinned
                ? isTopNavbar
                  ? t('minapp.remove_from_launchpad')
                  : t('minapp.remove_from_sidebar')
                : isTopNavbar
                  ? t('minapp.add_to_launchpad')
                  : t('minapp.add_to_sidebar')
            }
            placement="bottom"
            delay={800}>
            <TitleButton onClick={() => onTogglePin(appInfo.appId)} className={appInfo.isPinned ? 'pinned' : ''}>
              <PushpinOutlined style={{ fontSize: 16 }} />
            </TitleButton>
          </Tooltip>
        )}
        <Tooltip
          classNames={{ placeholder: 'contents' }}
          content={
            minappsOpenLinkExternal ? t('minapp.popup.open_link_external_on') : t('minapp.popup.open_link_external_off')
          }
          placement="bottom"
          delay={800}>
          <TitleButton onClick={onToggleOpenExternal} className={minappsOpenLinkExternal ? 'open-external' : ''}>
            <LinkOutlined />
          </TitleButton>
        </Tooltip>
        {isDev && (
          <Tooltip
            placement="bottom"
            classNames={{ placeholder: 'contents' }}
            content={t('minapp.popup.devtools')}
            delay={800}>
            <TitleButton onClick={() => onOpenDevTools(appInfo.appId)}>
              <CodeOutlined />
            </TitleButton>
          </Tooltip>
        )}
        {canMinimize && (
          <Tooltip
            placement="bottom"
            classNames={{ placeholder: 'contents' }}
            content={t('minapp.popup.minimize')}
            delay={800}>
            <TitleButton onClick={onMinimize}>
              <MinusOutlined />
            </TitleButton>
          </Tooltip>
        )}
        <Tooltip
          placement="bottom"
          classNames={{ placeholder: 'contents' }}
          content={t('minapp.popup.close')}
          delay={800}>
          <TitleButton onClick={() => onClose(appInfo.appId)}>
            <CloseOutlined />
          </TitleButton>
        </Tooltip>
      </ButtonsGroup>
      {(isWin || isLinux) && (
        <div style={{ position: 'absolute', right: 0, top: 0, height: '100%' }}>
          <WindowControls />
        </div>
      )}
    </TitleContainer>
  )
}

/** The main container for MinApp popup */
const MinappPopupContainer: React.FC = () => {
  const [minappsOpenLinkExternal, setMinappsOpenLinkExternal] = usePreference('feature.minapp.open_link_external')
  const { closeMinapp, hideMinappPopup } = useMinappPopup()
  const {
    pinned,
    updatePinnedMinapps,
    allApps,
    openedKeepAliveMinapps,
    openedOneOffMinapp,
    currentMinappId,
    minappShow
  } = useMinapps()
  const backgroundColor = useNavBackgroundColor()
  const { isTopNavbar } = useNavbarPosition()

  /** control the drawer open or close */
  const [isPopupShow, setIsPopupShow] = useState(true)
  /** whether the current minapp is ready */
  const [isReady, setIsReady] = useState(false)
  /** the current REAL url of the minapp
   * different from the app preset url, because user may navigate in minapp */
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)

  /** store the last minapp id and show status */
  const lastMinappId = useRef<string | null>(null)
  const lastMinappShow = useRef<boolean>(false)

  /** store the webview refs, one of the key to make them keepalive */
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())
  /** Note: WebView loaded states now managed globally via webviewStateManager */
  /** whether the minapps open link external is enabled */

  const { isLeftNavbar } = useNavbarPosition()

  const { setTimeoutTimer } = useTimer()

  useBridge()

  /** set the popup display status */
  useEffect(() => {
    if (minappShow) {
      // init the current url
      if (currentMinappId && currentAppInfo) {
        setCurrentUrl(currentAppInfo.url)
      }

      setIsPopupShow(true)

      if (getWebviewLoaded(currentMinappId)) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Set external link behavior for current minapp
    if (currentMinappId) {
      const webviewElement = webviewRefs.current.get(currentMinappId)
      if (webviewElement) {
        try {
          const webviewId = webviewElement.getWebContentsId()
          if (webviewId) {
            void window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
          }
        } catch (error) {
          // WebView not ready yet, will be set when it's loaded
          logger.debug(`WebView ${currentMinappId} not ready for getWebContentsId()`)
        }
      }
    }
  }, [currentMinappId, minappsOpenLinkExternal])

  /** only the keepalive minapp can be minimized */
  const canMinimize = !(openedOneOffMinapp && openedOneOffMinapp.appId === currentMinappId)

  /** combine the openedKeepAliveMinapps and openedOneOffMinapp */
  const combinedApps = useMemo(() => {
    return [...openedKeepAliveMinapps, ...(openedOneOffMinapp ? [openedOneOffMinapp] : [])]
  }, [openedKeepAliveMinapps, openedOneOffMinapp])

  /** get the extra info of the apps */
  const appsExtraInfo = useMemo(() => {
    // Build Sets for O(1) lookups instead of O(n) .some() per app (js-set-map-lookups)
    const allAppIds = new Set(allApps.map((a) => a.appId))
    const pinnedIds = new Set(pinned.map((a) => a.appId))
    const result: Record<string, AppExtraInfo> = {}
    for (const app of combinedApps) {
      result[app.appId] = {
        canPinned: allAppIds.has(app.appId),
        isPinned: pinnedIds.has(app.appId),
        canOpenExternalLink: app.url.startsWith('http://') || app.url.startsWith('https://')
      }
    }
    return result
  }, [combinedApps, pinned, allApps])

  /** get the current app info with extra info */
  let currentAppInfo: AppInfo | null = null
  if (currentMinappId) {
    const currentApp = combinedApps.find((item) => item.appId === currentMinappId)
    if (currentApp) {
      currentAppInfo = { ...currentApp, ...appsExtraInfo[currentApp.appId] }
    }
  }

  /** will close the popup and delete the webview */
  const handlePopupClose = async (appid: string) => {
    setIsPopupShow(false)
    await delay(0.3)
    clearWebviewState(appid)
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
    if (element) {
      webviewRefs.current.set(appid, element)
    } else {
      webviewRefs.current.delete(appid)
    }
  }

  /** the callback function to set the webviews loaded indicator */
  const handleWebviewLoaded = (appid: string) => {
    setWebviewLoaded(appid, true)
    const webviewElement = webviewRefs.current.get(appid)
    if (webviewElement) {
      try {
        const webviewId = webviewElement.getWebContentsId()
        if (webviewId) {
          void window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
        }
      } catch (error) {
        logger.debug(`WebView ${appid} not ready for getWebContentsId() in handleWebviewLoaded`)
      }
    }
    if (appid === currentMinappId) {
      setTimeoutTimer('handleWebviewLoaded', () => setIsReady(true), 200)
    }
  }

  /** the callback function to handle webview navigation */
  const handleWebviewNavigate = (appid: string, url: string) => {
    // 记录当前URL，用于GoogleLoginTip判断
    if (appid === currentMinappId) {
      logger.debug(`URL changed: ${url}`)
      setCurrentUrl(url)
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
      const url = combinedApps.find((item) => item.appId === appid)?.url
      if (url) {
        webview.src = url
      }
    }
  }

  /** open the giving url in browser */
  const handleOpenLink = (url: string) => {
    void window.api.openWebsite(url)
  }

  /** toggle the pin status of the minapp */
  const handleTogglePin = (appid: string) => {
    const app = combinedApps.find((item) => item.appId === appid)
    if (!app) return

    const newPinned = appsExtraInfo[appid].isPinned ? pinned.filter((item) => item.appId !== appid) : [...pinned, app]
    void updatePinnedMinapps(newPinned)
  }

  /** set the open external status */
  const handleToggleOpenExternal = () => {
    void setMinappsOpenLinkExternal(!minappsOpenLinkExternal)
  }

  /** navigate back in webview history */
  const handleGoBack = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      try {
        if (webview.canGoBack()) {
          webview.goBack()
        }
      } catch (error) {
        logger.debug(`WebView ${appid} not ready for goBack()`)
      }
    }
  }

  /** navigate forward in webview history */
  const handleGoForward = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      try {
        if (webview.canGoForward()) {
          webview.goForward()
        }
      } catch (error) {
        logger.debug(`WebView ${appid} not ready for goForward()`)
      }
    }
  }

  /** Title bar - rendered via module-level TitleBar component to avoid remount (rerender-no-inline-components) */

  /** group the webview containers with Memo, one of the key to make them keepalive */
  const WebviewContainerGroup = useMemo(() => {
    return combinedApps.map((app) => (
      <WebviewContainer
        key={app.appId}
        appid={app.appId}
        url={app.url}
        onSetRefCallback={handleWebviewSetRef}
        onLoadedCallback={handleWebviewLoaded}
        onNavigateCallback={handleWebviewNavigate}
      />
    ))

    // because the combinedApps is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedApps])

  return (
    <Drawer
      direction="bottom"
      open={isPopupShow}
      onOpenChange={(open) => {
        if (!open) void handlePopupMinimize()
      }}
      modal={false}
      dismissible={false}>
      <DrawerContentMinimal
        className="minapp-drawer inset-x-0 bottom-0"
        style={{
          height: isTopNavbar ? 'calc(100% - var(--navbar-height))' : '100%',
          marginLeft: isLeftNavbar ? 'var(--sidebar-width)' : 0,
          marginTop: isTopNavbar ? 'var(--navbar-height)' : 0,
          backgroundColor: window.root.style.background
        }}>
        {!isTopNavbar && (
          <div
            className="relative shrink-0"
            style={{
              minHeight: 'calc(var(--navbar-height) + 0.5px)',
              marginTop: '-0.5px',
              // @ts-expect-error -- Electron-specific CSS property for window dragging
              WebkitAppRegion: 'drag'
            }}>
            <TitleBar
              appInfo={currentAppInfo}
              url={currentUrl}
              backgroundColor={backgroundColor}
              isTopNavbar={isTopNavbar}
              canMinimize={canMinimize}
              minappsOpenLinkExternal={minappsOpenLinkExternal}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              onReload={handleReload}
              onTogglePin={handleTogglePin}
              onToggleOpenExternal={handleToggleOpenExternal}
              onOpenDevTools={handleOpenDevTools}
              onMinimize={handlePopupMinimize}
              onClose={handlePopupClose}
              onOpenLink={handleOpenLink}
            />
          </div>
        )}
        <div
          className="flex-1 overflow-hidden rounded-tl-[10px]"
          style={{ backgroundColor: 'var(--color-background)' }}>
          {/* 在所有小程序中显示GoogleLoginTip */}
          <GoogleLoginTip isReady={isReady} currentUrl={currentUrl} currentAppId={currentMinappId} />
          {!isReady && (
            <EmptyView style={{ backgroundColor: 'var(--color-background-soft)' }}>
              <LogoAvatar logo={currentAppInfo?.logo} size={80} />
              <BeatLoader color="var(--color-text-2)" size={10} style={{ marginTop: 15 }} />
            </EmptyView>
          )}
          {WebviewContainerGroup}
        </div>
      </DrawerContentMinimal>
    </Drawer>
  )
}

const TitleContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-right: 10px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: transparent;
  [navbar-position='left'] & {
    padding-left: ${isMac ? '40px' : '10px'};
  }
  [navbar-position='top'] & {
    padding-left: ${isMac ? '80px' : '10px'};
    border-bottom: 0.5px solid var(--color-border);
  }
`

const TitleText = styled.div`
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-1);
  -webkit-app-region: no-drag;
  margin-right: 5px;
`

const TitleTextTooltip = styled.span`
  font-size: 0.8rem;

  .icon-copy {
    font-size: 0.7rem;
    padding-right: 5px;
  }
`

const ButtonsGroup = styled.div<{ isTopNavbar: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  -webkit-app-region: no-drag;
  &.windows {
    background-color: var(--color-background-mute);
    border-radius: 50px;
    padding: 0 3px;
    overflow: hidden;
  }
`

const TitleButton = styled.div`
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
  -webkit-app-region: no-drag;
  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-background-mute);
  }
  &.pinned {
    color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
  &.open-external {
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

const Spacer = styled.div`
  flex: 1;
`

export default MinappPopupContainer
