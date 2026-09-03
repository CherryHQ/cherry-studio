import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { WebviewHost } from '@renderer/components/WebviewHost'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import type { DidNavigateEvent, DidNavigateInPageEvent, DidStartNavigationEvent, WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('MiniAppWebviewContainer')

/** MiniApp lifecycle and shortcuts layered on top of the shared WebView host. */
const WebviewContainer = memo(
  ({
    appid,
    url,
    onSetRefCallback,
    onLoadedCallback,
    onNavigateCallback
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
  }) => {
    const webviewRef = useRef<WebviewTag | null>(null)
    const loadCallbackFiredRef = useRef(false)
    const loadCallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const { t } = useTranslation()
    const [openLinkExternal] = usePreference('feature.mini_app.open_link_external')

    const clearLoadCallbackTimer = useCallback(() => {
      if (loadCallbackTimerRef.current === null) return
      clearTimeout(loadCallbackTimerRef.current)
      loadCallbackTimerRef.current = null
    }, [])

    const handleWebviewChange = useCallback(
      (element: WebviewTag | null) => {
        webviewRef.current = element
        onSetRefCallback(appid, element)
      },
      [appid, onSetRefCallback]
    )

    const handleStartNavigation = useCallback(
      (event: DidStartNavigationEvent) => {
        if (!event.isMainFrame || event.isInPlace) return

        clearLoadCallbackTimer()
        // Reset callback flag when starting a new main-frame load.
        loadCallbackFiredRef.current = false
      },
      [clearLoadCallbackTimer]
    )

    const handleLoaded = useCallback(() => {
      logger.debug(`WebView did-finish-load for app: ${appid}`)
      if (loadCallbackFiredRef.current) return
      loadCallbackFiredRef.current = true
      loadCallbackTimerRef.current = setTimeout(() => {
        loadCallbackTimerRef.current = null
        onLoadedCallback(appid)
      }, 100)
    }, [appid, onLoadedCallback])

    const handleReadyToShow = useCallback(() => {
      logger.debug(`WebView ready-to-show for app: ${appid}`)
      if (loadCallbackFiredRef.current) return
      loadCallbackFiredRef.current = true
      onLoadedCallback(appid)
    }, [appid, onLoadedCallback])

    const handleNavigate = useCallback(
      (event: DidNavigateEvent | DidNavigateInPageEvent) => {
        if ('isMainFrame' in event && !event.isMainFrame) return
        onNavigateCallback(appid, event.url)
      },
      [appid, onNavigateCallback]
    )

    useEffect(() => clearLoadCallbackTimer, [clearLoadCallbackTimer])

    useIpcOn('webview.search_hotkey_pressed', async (payload) => {
      const webviewId = webviewRef.current?.getWebContentsId()
      if (!webviewId || payload.webviewId !== webviewId) return

      const key = payload.key?.toLowerCase()
      const isModifier = payload.control || payload.meta
      if (!isModifier || !key) return

      try {
        if (key === 'p') {
          logger.info(`Printing webview ${appid} to PDF`)
          const filePath = await ipcApi.request('webview.print_to_pdf', { webviewId })
          if (filePath) toast.success(t('miniApp.shortcut.pdf_saved', { path: filePath }))
        } else if (key === 's') {
          logger.info(`Saving webview ${appid} as HTML`)
          const filePath = await ipcApi.request('webview.save_as_html', { webviewId })
          if (filePath) toast.success(t('miniApp.shortcut.html_saved', { path: filePath }))
        }
      } catch (error) {
        logger.error(`Failed to handle shortcut for webview ${appid}:`, error as Error)
        toast.error(t('miniApp.shortcut.failed', { message: (error as Error).message }))
      }
    })

    return (
      <WebviewHost
        id={`mini-app:${appid}`}
        src={url}
        securityProfile={WebviewSecurityProfile.MiniApp}
        allowPopups
        openLinksExternal={openLinkExternal}
        elementAttributes={{ 'data-mini-app-id': appid }}
        userAgent={
          appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36'
            : undefined
        }
        style={{ width: '100%', height: '100%', backgroundColor: 'var(--background)', display: 'inline-flex' }}
        onWebviewChange={handleWebviewChange}
        onDidStartNavigation={handleStartNavigation}
        onDidFinishLoad={handleLoaded}
        onReadyToShow={handleReadyToShow}
        onDidNavigate={handleNavigate}
      />
    )
  }
)

export default WebviewContainer
