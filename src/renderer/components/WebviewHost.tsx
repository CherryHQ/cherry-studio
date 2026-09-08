import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { MINI_APP_KEYDOWN_CHANNEL, type MiniAppKeyPayload } from '@shared/utils/webviewKey'
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  DidStartNavigationEvent,
  IpcMessageEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag
} from 'electron'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

const logger = loggerService.withContext('WebviewHost')

interface Props {
  id: string
  src: string
  partition: string
  reloadKey?: number | string
  allowPopups?: boolean
  /** Omit to preserve a runtime-owned popup policy, such as a local MiniApp sandbox. */
  openLinksExternal?: boolean
  userAgent?: string
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  testId?: string
  elementAttributes?: Readonly<Record<`data-${string}`, string>>
  onWebviewChange?: (webview: WebviewTag | null) => void
  onFocusChange?: (focused: boolean) => void
  onDomReady?: (webview: WebviewTag) => void
  onDidStartLoading?: () => void
  onDidStartNavigation?: (event: DidStartNavigationEvent) => void
  onDidFinishLoad?: () => void
  onReadyToShow?: () => void
  onDidNavigate?: (event: DidNavigateEvent | DidNavigateInPageEvent) => void
  onDidFailLoad?: (event: DidFailLoadEvent) => void
  onPageTitleUpdated?: (event: PageTitleUpdatedEvent) => void
  onPageFaviconUpdated?: (event: PageFaviconUpdatedEvent) => void
}

/**
 * Shared Electron WebView host. It owns only guest lifecycle and common WebView
 * preferences; product-specific chrome and persistence stay with each caller.
 */
export function WebviewHost({
  id,
  src,
  partition,
  reloadKey,
  allowPopups = false,
  openLinksExternal,
  userAgent,
  className,
  style,
  ariaLabel,
  testId,
  elementAttributes,
  onWebviewChange,
  onFocusChange,
  onDomReady,
  onDidStartLoading,
  onDidStartNavigation,
  onDidFinishLoad,
  onReadyToShow,
  onDidNavigate,
  onDidFailLoad,
  onPageTitleUpdated,
  onPageFaviconUpdated
}: Props) {
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [webview, setWebview] = useState<WebviewTag | null>(null)
  const onWebviewChangeRef = useRef(onWebviewChange)
  const readyWebviewRef = useRef<WebviewTag | null>(null)
  const committedLocationRef = useRef<{ webview: WebviewTag; url: string } | null>(null)
  const loadedSourceRef = useRef<{ reloadKey?: number | string; src?: string; webview?: WebviewTag }>({})

  const handleRef = useCallback(
    (element: WebviewTag | null) => {
      if (element) {
        if (allowPopups) element.setAttribute('allowpopups', 'true')
        else element.removeAttribute('allowpopups')
      }
      setWebview(element)
      onWebviewChangeRef.current?.(element)
    },
    [allowPopups]
  )

  useEffect(() => {
    onWebviewChangeRef.current = onWebviewChange
  }, [onWebviewChange])

  useEffect(() => {
    if (!webview) return
    if (allowPopups) webview.setAttribute('allowpopups', 'true')
    else webview.removeAttribute('allowpopups')
  }, [allowPopups, webview])

  const applyGuestPreferences = useCallback(
    (guest: WebviewTag) => {
      try {
        const webviewId = guest.getWebContentsId()
        if (!webviewId) return
        void ipcApi
          .request('webview.set_spell_check_enabled', { webviewId, isEnable: enableSpellCheck })
          .catch((error) => logger.debug('Failed to update WebView spell check', { id, error }))
        if (openLinksExternal !== undefined) {
          void ipcApi
            .request('webview.set_open_link_external', { webviewId, isExternal: openLinksExternal })
            .catch((error) => logger.debug('Failed to update WebView link handling', { id, error }))
        }
      } catch (error) {
        logger.debug('WebView is not ready for guest preferences', { id, error })
      }
    },
    [enableSpellCheck, id, openLinksExternal]
  )

  const handleDomReady = useEffectEvent((guest: WebviewTag) => {
    readyWebviewRef.current = guest
    applyGuestPreferences(guest)
    onDomReady?.(guest)
  })
  const handleStartLoading = useEffectEvent(() => {
    readyWebviewRef.current = null
    onDidStartLoading?.()
  })
  const handleNavigate = useEffectEvent((event: DidNavigateEvent | DidNavigateInPageEvent) => {
    if (webview && (!('isMainFrame' in event) || event.isMainFrame)) {
      committedLocationRef.current = { webview, url: event.url }
    }
    onDidNavigate?.(event)
  })
  const handleStartNavigation = useEffectEvent((event: DidStartNavigationEvent) => onDidStartNavigation?.(event))
  const handleFinishLoad = useEffectEvent(() => onDidFinishLoad?.())
  const handleReadyToShow = useEffectEvent(() => onReadyToShow?.())
  const handleFailLoad = useEffectEvent((event: DidFailLoadEvent) => onDidFailLoad?.(event))
  const handleTitleUpdated = useEffectEvent((event: PageTitleUpdatedEvent) => onPageTitleUpdated?.(event))
  const handleFaviconUpdated = useEffectEvent((event: PageFaviconUpdatedEvent) => onPageFaviconUpdated?.(event))
  const handleFocus = useEffectEvent(() => onFocusChange?.(true))
  const handleBlur = useEffectEvent(() => onFocusChange?.(false))

  useEffect(() => {
    if (!webview) return
    const domReady = () => handleDomReady(webview)

    // Replay the guest's keydown on the host window so the normal keybinding
    // resolution (find-in-page and friends) sees it; `target` identifies the webview.
    const handleGuestKeydown = (event: IpcMessageEvent) => {
      if (event.channel !== MINI_APP_KEYDOWN_CHANNEL) return

      const payload = event.args[0] as MiniAppKeyPayload | undefined
      if (!payload?.isTrusted || document.activeElement !== webview) return

      const replayed = new KeyboardEvent('keydown', { ...payload, cancelable: true })
      Object.defineProperty(replayed, 'target', { get: () => webview })
      window.dispatchEvent(replayed)
    }

    webview.addEventListener('focus', handleFocus)
    webview.addEventListener('blur', handleBlur)
    webview.addEventListener('ipc-message', handleGuestKeydown)
    webview.addEventListener('dom-ready', domReady)
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-start-navigation', handleStartNavigation)
    webview.addEventListener('did-finish-load', handleFinishLoad)
    webview.addEventListener('ready-to-show', handleReadyToShow)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFailLoad)
    webview.addEventListener('page-title-updated', handleTitleUpdated)
    webview.addEventListener('page-favicon-updated', handleFaviconUpdated)

    try {
      // Activity can resume an already-loaded guest without another dom-ready event.
      if (webview.getWebContentsId() && !webview.isLoading()) domReady()
    } catch {
      // New guests report readiness through dom-ready once their native contents exist.
    }

    return () => {
      webview.removeEventListener('focus', handleFocus)
      webview.removeEventListener('blur', handleBlur)
      webview.removeEventListener('ipc-message', handleGuestKeydown)
      webview.removeEventListener('dom-ready', domReady)
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-start-navigation', handleStartNavigation)
      webview.removeEventListener('did-finish-load', handleFinishLoad)
      webview.removeEventListener('ready-to-show', handleReadyToShow)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFailLoad)
      webview.removeEventListener('page-title-updated', handleTitleUpdated)
      webview.removeEventListener('page-favicon-updated', handleFaviconUpdated)
      if (readyWebviewRef.current === webview) readyWebviewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This lint version does not recognize React 19.2 Effect Events.
  }, [webview])

  useEffect(() => {
    if (!webview) return
    const previous = loadedSourceRef.current
    loadedSourceRef.current = { reloadKey, src, webview }

    if (previous.webview !== webview || previous.src !== src) {
      if (committedLocationRef.current?.webview === webview && committedLocationRef.current.url === src) return
      webview.setAttribute('src', src)
      return
    }
    if (previous.reloadKey !== undefined && previous.reloadKey !== reloadKey) {
      try {
        webview.reload()
      } catch (error) {
        logger.debug('WebView is not ready to reload', { id, error })
      }
    }
  }, [id, reloadKey, src, webview])

  useEffect(() => {
    if (webview && readyWebviewRef.current === webview) applyGuestPreferences(webview)
  }, [applyGuestPreferences, webview])

  return (
    <webview
      key={`${id}:${partition}`}
      {...elementAttributes}
      ref={handleRef}
      partition={partition}
      useragent={userAgent}
      aria-label={ariaLabel}
      data-testid={testId}
      className={className}
      style={style}
    />
  )
}
