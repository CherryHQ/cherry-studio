import { usePreference } from '@data/hooks/usePreference'
import type { DidNavigateInPageEvent, DidStartNavigationEvent, WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('WebviewContainer')

/**
 * WebviewContainer is a component that renders a webview element.
 * It is used in the MiniAppPopupContainer component.
 * The webcontent can be remain in memory
 */
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
    const { t } = useTranslation()
    const [enableSpellCheck] = usePreference('app.spell_check.enabled')
    const [openLinkExternal] = usePreference('feature.mini_app.open_link_external')
    const handleRef = useCallback(
      (element: WebviewTag | null) => {
        onSetRefCallback(appid, element)
        if (element) {
          // React omits unknown boolean attributes; Electron enables popups by attribute presence.
          element.setAttribute('allowpopups', 'true')
          webviewRef.current = element
        } else {
          webviewRef.current = null
        }
      },
      [appid, onSetRefCallback]
    )

    useEffect(() => {
      const webview = webviewRef.current
      if (!webview) return

      let loadCallbackFired = false
      let loadCallbackTimer: ReturnType<typeof setTimeout> | null = null

      const clearLoadCallbackTimer = () => {
        if (loadCallbackTimer === null) return
        clearTimeout(loadCallbackTimer)
        loadCallbackTimer = null
      }

      const handleLoaded = () => {
        logger.debug(`WebView did-finish-load for app: ${appid}`)
        // Only fire callback once per load cycle
        if (!loadCallbackFired) {
          loadCallbackFired = true
          // Small delay to ensure content is actually visible
          loadCallbackTimer = setTimeout(() => {
            loadCallbackTimer = null
            logger.debug(`Calling onLoadedCallback for app: ${appid}`)
            onLoadedCallback(appid)
          }, 100)
        }
      }

      // Additional callback for when page is ready to show
      const handleReadyToShow = () => {
        logger.debug(`WebView ready-to-show for app: ${appid}`)
        if (!loadCallbackFired) {
          loadCallbackFired = true
          logger.debug(`Calling onLoadedCallback from ready-to-show for app: ${appid}`)
          onLoadedCallback(appid)
        }
      }

      const handleNavigate = (event: DidNavigateInPageEvent) => {
        onNavigateCallback(appid, event.url)
      }

      const handleDomReady = () => {
        const webviewId = webview.getWebContentsId()
        if (webviewId) {
          void ipcApi.request('webview.set_spell_check_enabled', { webviewId, isEnable: enableSpellCheck })
          // Set link opening behavior for this webview
          void ipcApi.request('webview.set_open_link_external', { webviewId, isExternal: openLinkExternal })
        }
      }

      const handleStartNavigation = (event: DidStartNavigationEvent) => {
        if (!event.isMainFrame || event.isInPlace) return

        clearLoadCallbackTimer()
        // Reset callback flag when starting a new main-frame load.
        loadCallbackFired = false
      }

      webview.addEventListener('did-start-navigation', handleStartNavigation)
      webview.addEventListener('dom-ready', handleDomReady)
      webview.addEventListener('did-finish-load', handleLoaded)
      webview.addEventListener('ready-to-show', handleReadyToShow)
      webview.addEventListener('did-navigate-in-page', handleNavigate)

      // we set the url when the webview is ready
      webview.src = url

      return () => {
        clearLoadCallbackTimer()
        webview.removeEventListener('did-start-navigation', handleStartNavigation)
        webview.removeEventListener('dom-ready', handleDomReady)
        webview.removeEventListener('did-finish-load', handleLoaded)
        webview.removeEventListener('ready-to-show', handleReadyToShow)
        webview.removeEventListener('did-navigate-in-page', handleNavigate)
      }
      // because the appid and url are enough, no need to add onLoadedCallback
      // oxlint-disable-next-line react/exhaustive-deps
    }, [appid, url])

    // Setup keyboard shortcuts handler for print and save
    useIpcOn('webview.search_hotkey_pressed', async (payload) => {
      // Get webviewId when event is triggered
      const webviewId = webviewRef.current?.getWebContentsId()

      // Only handle events for this webview
      if (!webviewId || payload.webviewId !== webviewId) return

      const key = payload.key?.toLowerCase()
      const isModifier = payload.control || payload.meta

      if (!isModifier || !key) return

      try {
        if (key === 'p') {
          // Print to PDF
          logger.info(`Printing webview ${appid} to PDF`)
          const filePath = await ipcApi.request('webview.print_to_pdf', { webviewId })
          if (filePath) {
            toast.success(t('miniApp.shortcut.pdf_saved', { path: filePath }))
            logger.info(`PDF saved to: ${filePath}`)
          }
        } else if (key === 's') {
          // Save as HTML
          logger.info(`Saving webview ${appid} as HTML`)
          const filePath = await ipcApi.request('webview.save_as_html', { webviewId })
          if (filePath) {
            toast.success(t('miniApp.shortcut.html_saved', { path: filePath }))
            logger.info(`HTML saved to: ${filePath}`)
          }
        }
      } catch (error) {
        logger.error(`Failed to handle shortcut for webview ${appid}:`, error as Error)
        toast.error(t('miniApp.shortcut.failed', { message: (error as Error).message }))
      }
    })

    // Update webview settings when they change
    useEffect(() => {
      if (!webviewRef.current) return

      try {
        const webviewId = webviewRef.current.getWebContentsId()
        if (webviewId) {
          void ipcApi.request('webview.set_spell_check_enabled', { webviewId, isEnable: enableSpellCheck })
          void ipcApi.request('webview.set_open_link_external', { webviewId, isExternal: openLinkExternal })
        }
      } catch (error) {
        // WebView may not be ready yet, settings will be applied in dom-ready event
        logger.debug(`WebView ${appid} not ready for settings update`)
      }
    }, [appid, openLinkExternal, enableSpellCheck])

    const WebviewStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--background)',
      display: 'inline-flex'
    }

    return (
      <webview
        key={appid}
        ref={handleRef}
        data-mini-app-id={appid}
        style={WebviewStyle}
        partition="persist:webview"
        useragent={
          appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'
            : undefined
        }
      />
    )
  }
)

export default WebviewContainer
