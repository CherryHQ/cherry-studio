import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { WebviewHost } from '@renderer/components/WebviewHost'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { MiniAppKind } from '@shared/data/types/miniApp'
import type { DidNavigateEvent, DidNavigateInPageEvent, DidStartNavigationEvent, WebviewTag } from 'electron'
import { type ComponentProps, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WebviewContainer')

type PrepareState = 'ready' | 'preparing' | 'failed'

/**
 * A `kind='app'` webview may not attach before the main process has installed the
 * protocol handler, network policy and proxy on its partition. `will-attach-webview`
 * can only veto — it is synchronous while `ensurePartition` is not — so the wait has
 * to happen here. `site` webviews carry no per-partition policy and mount at once.
 *
 * The hook returns readiness ONLY. It never learns the preload path: the element's
 * `preload` attribute wants a `file:` URL rather than a path, and main sets
 * `webPreferences.preload` itself in `will-attach-webview` — so there is nothing
 * here for the renderer to get wrong or to leak.
 */
function useMiniAppPrepared(appid: string, kind: MiniAppKind): PrepareState {
  const [state, setState] = useState<PrepareState>(kind === 'app' ? 'preparing' : 'ready')

  useEffect(() => {
    if (kind !== 'app') return setState('ready')
    let cancelled = false
    setState('preparing')
    ipcApi.request('mini_app.runtime.prepare', { appId: appid }).then(
      () => !cancelled && setState('ready'),
      (error) => {
        logger.error('Failed to prepare mini app partition', error)
        if (!cancelled) setState('failed')
      }
    )
    return () => {
      cancelled = true
    }
  }, [appid, kind])

  useEffect(() => {
    if (state !== 'ready' || kind !== 'app') return
    // Fire-and-forget ON PURPOSE: the page must paint whether or not the network
    // answers, and a failed check is not a failed launch.
    void ipcApi.request('mini_app.update.check_on_open', { appId: appid }).catch(() => {})
  }, [state, kind, appid])

  return state
}

/** MiniApp preparation and product callbacks around the shared guest host. */
const MiniAppWebview = memo(
  ({
    appid,
    url,
    kind,
    onSetRefCallback,
    onLoadedCallback,
    onNavigateCallback,
    onFocusChange
  }: {
    appid: string
    url: string
    kind: MiniAppKind
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
    onNavigateCallback: (appid: string, url: string) => void
    /** Reported to the pool, which owns the `webview.focused` context key for all panes. */
    onFocusChange?: (appid: string, focused: boolean) => void
  }) => {
    const webviewRef = useRef<WebviewTag | null>(null)
    const { t } = useTranslation()
    const [openLinkExternal] = usePreference('feature.mini_app.open_link_external')

    const handleRef = useCallback(
      (element: WebviewTag | null) => {
        onSetRefCallback(appid, element)
        webviewRef.current = element
      },
      [appid, onSetRefCallback]
    )

    const prepareState = useMiniAppPrepared(appid, kind)

    const loadedRef = useRef(false)
    const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearLoadTimer = useCallback(() => {
      if (loadTimerRef.current === null) return
      clearTimeout(loadTimerRef.current)
      loadTimerRef.current = null
    }, [])
    useEffect(() => clearLoadTimer, [clearLoadTimer])

    const handleLoaded = useCallback(() => {
      if (loadedRef.current) return
      loadedRef.current = true
      loadTimerRef.current = setTimeout(() => {
        loadTimerRef.current = null
        onLoadedCallback(appid)
      }, 100)
    }, [appid, onLoadedCallback])
    const handleReady = useCallback(() => {
      if (loadedRef.current) return
      loadedRef.current = true
      onLoadedCallback(appid)
    }, [appid, onLoadedCallback])
    const handleStartNavigation = useCallback(
      (event: DidStartNavigationEvent) => {
        if (!event.isMainFrame || event.isInPlace) return
        clearLoadTimer()
        loadedRef.current = false
      },
      [clearLoadTimer]
    )
    const handleNavigate = useCallback(
      (event: DidNavigateEvent | DidNavigateInPageEvent) => {
        if ('isMainFrame' in event && !event.isMainFrame) return
        onNavigateCallback(appid, event.url)
      },
      [appid, onNavigateCallback]
    )
    const handleFocusChange = useCallback((focused: boolean) => onFocusChange?.(appid, focused), [appid, onFocusChange])

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

    const WebviewStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--background)',
      display: 'inline-flex'
    }

    if (prepareState === 'failed') {
      return (
        <div data-mini-app-prepare-failed style={WebviewStyle}>
          {t('miniApp.error.prepare_failed')}
        </div>
      )
    }
    if (prepareState === 'preparing') return <div style={WebviewStyle} />

    return (
      <WebviewHost
        id={appid}
        src={url}
        onWebviewChange={handleRef}
        onDomReady={handleReady}
        onReadyToShow={handleReady}
        onDidFinishLoad={handleLoaded}
        onDidStartNavigation={handleStartNavigation}
        onDidNavigate={handleNavigate}
        onFocusChange={handleFocusChange}
        elementAttributes={{ 'data-mini-app-id': appid }}
        allowPopups={kind === 'site'}
        openLinksExternal={kind === 'site' ? openLinkExternal : undefined}
        style={WebviewStyle}
        partition={kind === 'app' ? `persist:miniapp:${appid}` : 'persist:webview'}
        userAgent={
          kind === 'site' && appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'
            : undefined
        }
      />
    )
  }
)

export default function WebviewContainer(props: ComponentProps<typeof MiniAppWebview>) {
  return <MiniAppWebview key={`${props.kind}:${props.appid}`} {...props} />
}
