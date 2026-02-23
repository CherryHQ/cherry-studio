import { loggerService } from '@logger'
import { useSettings } from '@renderer/hooks/useSettings'
import type { MinAppType } from '@renderer/types'
import type { WebviewTag } from 'electron'
import { memo, useEffect, useRef } from 'react'

const logger = loggerService.withContext('WebviewContainer')

const normalizeBypassRules = (rules?: string): string => {
  if (!rules) return ''
  return rules
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .sort()
    .join(',')
}

const hashString = (value: string): string => {
  // djb2 variant, enough for stable local partition bucketing.
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

const getPartitionForApp = (app: MinAppType): string => {
  const mode = app.proxyMode || 'inherit'

  if (mode === 'inherit') {
    return 'persist:webview'
  }

  if (mode === 'system') {
    return 'persist:webview:proxy:system'
  }

  if (mode === 'direct') {
    return 'persist:webview:proxy:direct'
  }

  const proxyUrl = (app.proxyUrl || '').trim()
  const bypassRules = normalizeBypassRules(app.proxyBypassRules)
  const configHash = hashString(`custom|${proxyUrl}|${bypassRules}`)
  return `persist:webview:proxy:${configHash}`
}

/**
 * WebviewContainer is a component that renders a webview element.
 * It is used in the MinAppPopupContainer component.
 * The webcontent can be remain in memory
 */
const WebviewContainer = memo(
  ({
    app,
    onSetRefCallback,
    onLoadedCallback,
    onNavigateCallback
  }: {
    app: MinAppType
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
  }) => {
    const appid = app.id
    const url = app.url
    const partition = getPartitionForApp(app)
    const webviewRef = useRef<WebviewTag | null>(null)
    const { enableSpellCheck, minappsOpenLinkExternal } = useSettings()

    const setRef = (appid: string) => {
      onSetRefCallback(appid, null)

      return (element: WebviewTag | null) => {
        onSetRefCallback(appid, element)
        if (element) {
          webviewRef.current = element
        } else {
          webviewRef.current = null
        }
      }
    }

    useEffect(() => {
      if (!webviewRef.current) return

      let loadCallbackFired = false

      const handleLoaded = () => {
        logger.debug(`WebView did-finish-load for app: ${appid}`)
        // Only fire callback once per load cycle
        if (!loadCallbackFired) {
          loadCallbackFired = true
          // Small delay to ensure content is actually visible
          setTimeout(() => {
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

      const handleNavigate = (event: any) => {
        onNavigateCallback(appid, event.url)
      }

      const handleDomReady = () => {
        const webviewId = webviewRef.current?.getWebContentsId()
        if (webviewId) {
          window.api?.webview?.setSpellCheckEnabled?.(webviewId, enableSpellCheck)
          // Set link opening behavior for this webview
          window.api?.webview?.setOpenLinkExternal?.(webviewId, minappsOpenLinkExternal)
        }
      }

      const handleStartLoading = () => {
        // Reset callback flag when starting a new load
        loadCallbackFired = false
      }

      webviewRef.current.addEventListener('did-start-loading', handleStartLoading)
      webviewRef.current.addEventListener('dom-ready', handleDomReady)
      webviewRef.current.addEventListener('did-finish-load', handleLoaded)
      webviewRef.current.addEventListener('ready-to-show', handleReadyToShow)
      webviewRef.current.addEventListener('did-navigate-in-page', handleNavigate)

      const loadWebview = async () => {
        try {
          if (!webviewRef.current) return

          // Dedicated partition is used only when per-minapp proxy mode is set.
          if (partition !== 'persist:webview') {
            if (app.proxyMode === 'custom' && app.proxyUrl) {
              await window.api.webview.setPartitionProxy(partition, {
                mode: 'fixed_servers',
                proxyRules: app.proxyUrl,
                proxyBypassRules: app.proxyBypassRules
              })
            } else if (app.proxyMode === 'system') {
              await window.api.webview.setPartitionProxy(partition, { mode: 'system' })
            } else {
              await window.api.webview.setPartitionProxy(partition, { mode: 'direct' })
            }
          }

          // we set the url when the webview is ready
          webviewRef.current.src = url
        } catch (error) {
          logger.error(`Failed to configure proxy for minapp ${appid}:`, error as Error)
          if (webviewRef.current) {
            webviewRef.current.src = url
          }
        }
      }

      void loadWebview()

      return () => {
        webviewRef.current?.removeEventListener('did-start-loading', handleStartLoading)
        webviewRef.current?.removeEventListener('dom-ready', handleDomReady)
        webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
        webviewRef.current?.removeEventListener('ready-to-show', handleReadyToShow)
        webviewRef.current?.removeEventListener('did-navigate-in-page', handleNavigate)
      }
      // because the appid and url are enough, no need to add onLoadedCallback
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appid, url, partition, app.proxyMode, app.proxyUrl, app.proxyBypassRules])

    // Setup keyboard shortcuts handler for print and save
    useEffect(() => {
      if (!webviewRef.current) return

      const unsubscribe = window.api?.webview?.onFindShortcut?.(async (payload) => {
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
            const filePath = await window.api.webview.printToPDF(webviewId)
            if (filePath) {
              window.toast?.success?.(`PDF saved to: ${filePath}`)
              logger.info(`PDF saved to: ${filePath}`)
            }
          } else if (key === 's') {
            // Save as HTML
            logger.info(`Saving webview ${appid} as HTML`)
            const filePath = await window.api.webview.saveAsHTML(webviewId)
            if (filePath) {
              window.toast?.success?.(`HTML saved to: ${filePath}`)
              logger.info(`HTML saved to: ${filePath}`)
            }
          }
        } catch (error) {
          logger.error(`Failed to handle shortcut for webview ${appid}:`, error as Error)
          window.toast?.error?.(`Failed: ${(error as Error).message}`)
        }
      })

      return () => {
        unsubscribe?.()
      }
    }, [appid])

    // Update webview settings when they change
    useEffect(() => {
      if (!webviewRef.current) return

      try {
        const webviewId = webviewRef.current.getWebContentsId()
        if (webviewId) {
          window.api?.webview?.setSpellCheckEnabled?.(webviewId, enableSpellCheck)
          window.api?.webview?.setOpenLinkExternal?.(webviewId, minappsOpenLinkExternal)
        }
      } catch (error) {
        // WebView may not be ready yet, settings will be applied in dom-ready event
        logger.debug(`WebView ${appid} not ready for settings update`)
      }
    }, [appid, minappsOpenLinkExternal, enableSpellCheck])

    const WebviewStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--color-background)',
      display: 'inline-flex'
    }

    return (
      <webview
        key={`${appid}:${partition}`}
        ref={setRef(appid)}
        data-minapp-id={appid}
        style={WebviewStyle}
        allowpopups={'true' as any}
        partition={partition}
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
