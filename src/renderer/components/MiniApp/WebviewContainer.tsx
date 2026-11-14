import type { DidStartNavigationEvent, WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { WebviewHost } from '@renderer/components/WebviewHost'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { MiniAppKind } from '@shared/data/types/miniApp'
import { isMiniAppRegionEligible, selectedMiniAppCountry } from '@shared/utils/miniAppRegion'

const logger = loggerService.withContext('WebviewContainer')

type PrepareState = 'ready' | 'preparing' | 'failed'

/**
 * A `kind='app'` webview may not attach before the main process has installed the
 * protocol handler, network policy and proxy on its partition. `will-attach-webview`
 * can only veto — it is synchronous while `ensurePartition` is not — so the wait has
 * to happen here. Site guests also wait for their selected partition and proxy.
 *
 * The hook returns the prepared partition. It never learns the preload path: the element's
 * `preload` attribute wants a `file:` URL rather than a path, and main sets
 * `webPreferences.preload` itself in `will-attach-webview` — so there is nothing
 * here for the renderer to get wrong or to leak.
 */
function useMiniAppPrepared(appid: string, kind: MiniAppKind) {
  const [state, setState] = useState<PrepareState>('preparing')
  const [partition, setPartition] = useState(kind === 'app' ? `persist:miniapp:${appid}` : 'persist:webview')
  const [fake, setFake] = useState(false)

  useEffect(() => {
    let cancelled = false
    let leaseId: string | null = null
    const release = (id: string) => {
      void ipcApi
        .request('webview.region.release', { leaseId: id })
        .catch((error) => logger.warn('Regional lease release failed', { error }))
    }
    setState('preparing')
    const prepare =
      kind === 'app'
        ? ipcApi
            .request('mini_app.runtime.prepare', { appId: appid })
            .then(() => ({ partition: `persist:miniapp:${appid}`, fake: false, leaseId: null }))
        : ipcApi.request('webview.region.prepare', { appId: appid })
    prepare.then(
      (prepared) => {
        if (cancelled) {
          if (prepared.leaseId) release(prepared.leaseId)
          return
        }
        leaseId = prepared.leaseId
        setPartition(prepared.partition)
        setFake(prepared.fake)
        setState('ready')
      },
      (error) => {
        logger.error('Failed to prepare mini app partition', error)
        if (!cancelled) setState('failed')
      }
    )
    return () => {
      cancelled = true
      if (leaseId) release(leaseId)
    }
  }, [appid, kind])

  useEffect(() => {
    if (state !== 'ready' || kind !== 'app') return
    // Fire-and-forget ON PURPOSE: the page must paint whether or not the network
    // answers, and a failed check is not a failed launch.
    void ipcApi.request('mini_app.update.check_on_open', { appId: appid }).catch(() => {})
  }, [state, kind, appid])

  return { state, partition, fake }
}

/** MiniApp preparation and product callbacks around the shared guest host. */
const MiniAppWebview = memo(
  ({
    appid,
    url,
    kind,
    onSetRefCallback,
    onLoadedCallback,
    onFocusChange
  }: {
    appid: string
    url: string
    kind: MiniAppKind
    onSetRefCallback: (appid: string, element: WebviewTag | null) => void
    onLoadedCallback: (appid: string) => void
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

    const { state: prepareState, partition, fake } = useMiniAppPrepared(appid, kind)
    const [regionReady, setRegionReady] = useState(false)
    const [regionFailed, setRegionFailed] = useState(false)
    const regionStarted = useRef(false)
    useIpcOn('webview.region.failed', ({ webviewId }) => {
      if (webviewRef.current?.getWebContentsId() === webviewId) setRegionFailed(true)
    })

    const loadedRef = useRef(false)
    const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const clearLoadTimer = useCallback(() => {
      if (loadTimerRef.current === null) return
      clearTimeout(loadTimerRef.current)
      loadTimerRef.current = null
    }, [])
    useEffect(() => clearLoadTimer, [clearLoadTimer])

    const handleLoaded = useCallback(() => {
      if (fake && !regionReady) return
      if (loadedRef.current) return
      loadedRef.current = true
      loadTimerRef.current = setTimeout(() => {
        loadTimerRef.current = null
        onLoadedCallback(appid)
      }, 100)
    }, [appid, onLoadedCallback, fake, regionReady])
    const handleReady = useCallback(() => {
      if (fake && !regionReady) return
      if (loadedRef.current) return
      loadedRef.current = true
      onLoadedCallback(appid)
    }, [appid, onLoadedCallback, fake, regionReady])
    const handleDomReady = useCallback(
      (guest: WebviewTag) => {
        if (fake && !regionStarted.current) {
          regionStarted.current = true
          void ipcApi.request('webview.region.wait_until_ready', { webviewId: guest.getWebContentsId() }).then(
            () => setRegionReady(true),
            (error) => {
              logger.warn('Unable to apply mini app regional profile', { error })
              setRegionFailed(true)
            }
          )
          return
        }
        handleReady()
      },
      [fake, handleReady]
    )
    const handleStartNavigation = useCallback(
      (event: DidStartNavigationEvent) => {
        if (!event.isMainFrame || event.isInPlace) return
        clearLoadTimer()
        loadedRef.current = false
      },
      [clearLoadTimer]
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

    if (prepareState === 'failed' || regionFailed) {
      return (
        <div data-mini-app-prepare-failed style={WebviewStyle}>
          {t(regionFailed ? 'miniApp.region.failed' : 'miniApp.error.prepare_failed')}
        </div>
      )
    }
    if (prepareState === 'preparing') return <div style={WebviewStyle} />

    return (
      <WebviewHost
        id={appid}
        src={fake && !regionReady ? 'about:blank' : url}
        onWebviewChange={handleRef}
        onDomReady={handleDomReady}
        onReadyToShow={handleReady}
        onDidFinishLoad={handleLoaded}
        onDidStartNavigation={handleStartNavigation}
        onFocusChange={handleFocusChange}
        elementAttributes={{ 'data-mini-app-id': appid }}
        allowPopups={kind === 'site'}
        openLinksExternal={kind === 'site' ? openLinkExternal : undefined}
        style={WebviewStyle}
        partition={partition}
        userAgent={
          kind === 'site' && !fake && appid === 'google'
            ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)  Safari/537.36'
            : undefined
        }
      />
    )
  }
)

export default function WebviewContainer(props: ComponentProps<typeof MiniAppWebview>) {
  const [profiles] = usePreference('feature.mini_app.region_profiles')
  const [revision, setRevision] = useState(0)
  useIpcOn('webview.region.invalidated', ({ appId }) => {
    if (appId === props.appid) setRevision((value) => value + 1)
  })
  const [fakeAppIds] = usePreference('feature.mini_app.us_environment_app_ids')
  const [developerMode] = usePreference('app.developer_mode.enabled')
  const [fakeEnabled] = usePreference('feature.mini_app.fake_environment.enabled')
  const [fakeCountry] = usePreference('feature.mini_app.fake_environment.country')
  const selected = selectedMiniAppCountry(props.appid, profiles, fakeAppIds, fakeCountry)
  const environment = isMiniAppRegionEligible(props) && developerMode && fakeEnabled && selected ? selected : 'default'
  return <MiniAppWebview key={`${props.kind}:${props.appid}:${environment}:${revision}`} {...props} />
}
