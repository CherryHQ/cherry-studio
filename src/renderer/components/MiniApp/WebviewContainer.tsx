import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { MINI_APP_KEYDOWN_CHANNEL, type MiniAppKeyPayload } from '@shared/utils/webviewKey'
import type { DidNavigateInPageEvent, DidStartNavigationEvent, IpcMessageEvent, WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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
    onNavigateCallback,
    onFocusChange
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
    /** Reported to the pool, which owns the `webview.focused` context key for all panes. */
    onFocusChange?: (appid: string, focused: boolean) => void
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

        if (!loadCallbackFired) {
          loadCallbackFired = true
          logger.debug(`Calling onLoadedCallback from dom-ready for app: ${appid}`)
          onLoadedCallback(appid)
        }
      }

      const handleStartNavigation = (event: DidStartNavigationEvent) => {
        if (!event.isMainFrame || event.isInPlace) return

        clearLoadCallbackTimer()
        // Reset callback flag when starting a new main-frame load.
        loadCallbackFired = false
      }

      // Replay the guest's keydown on the host window so the normal keybinding
      // resolution sees it; `target` identifies which webview it came from.
      const handleGuestKeydown = (event: IpcMessageEvent) => {
        if (event.channel !== MINI_APP_KEYDOWN_CHANNEL) return

        const payload = event.args[0] as MiniAppKeyPayload | undefined
        if (!payload?.isTrusted || document.activeElement !== webview) return

        const replayed = new KeyboardEvent('keydown', { ...payload, cancelable: true })
        Object.defineProperty(replayed, 'target', { get: () => webview })
        window.dispatchEvent(replayed)
      }

      const handleFocus = () => onFocusChange?.(appid, true)
      const handleBlur = () => onFocusChange?.(appid, false)

      webview.addEventListener('ipc-message', handleGuestKeydown)
      webview.addEventListener('focus', handleFocus)
      webview.addEventListener('blur', handleBlur)
      webview.addEventListener('did-start-navigation', handleStartNavigation)
      webview.addEventListener('dom-ready', handleDomReady)
      webview.addEventListener('did-finish-load', handleLoaded)
      webview.addEventListener('ready-to-show', handleReadyToShow)
      webview.addEventListener('did-navigate-in-page', handleNavigate)

      // we set the url when the webview is ready
      webview.src = url

      return () => {
        clearLoadCallbackTimer()
        webview.removeEventListener('ipc-message', handleGuestKeydown)
        webview.removeEventListener('focus', handleFocus)
        webview.removeEventListener('blur', handleBlur)
        webview.removeEventListener('did-start-navigation', handleStartNavigation)
        webview.removeEventListener('dom-ready', handleDomReady)
        webview.removeEventListener('did-finish-load', handleLoaded)
        webview.removeEventListener('ready-to-show', handleReadyToShow)
        webview.removeEventListener('did-navigate-in-page', handleNavigate)
      }
      // because the appid and url are enough, no need to add onLoadedCallback
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appid, url])

    // Print / save-as-HTML for the guest page. Not renderer commands — they act on
    // this webview, so they key off the replayed event's target instead.
    useEffect(() => {
      const handleShortcut = async (event: KeyboardEvent) => {
        if (event.target !== webviewRef.current) return
        if (!event.ctrlKey && !event.metaKey) return

        const key = event.key.toLowerCase()
        if (key !== 'p' && key !== 's') return

        const webviewId = webviewRef.current?.getWebContentsId()
        if (!webviewId) return

        try {
          if (key === 'p') {
            logger.info(`Printing webview ${appid} to PDF`)
            const filePath = await ipcApi.request('webview.print_to_pdf', { webviewId })
            if (filePath) {
              toast.success(t('miniApp.shortcut.pdf_saved', { path: filePath }))
              logger.info(`PDF saved to: ${filePath}`)
            }
          } else {
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
      }

      window.addEventListener('keydown', handleShortcut)
      return () => window.removeEventListener('keydown', handleShortcut)
    }, [appid, t])

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
