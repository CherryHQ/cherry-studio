import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import type { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { getWebviewPartition } from '@shared/utils/webviewSecurity'
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  DidStartNavigationEvent,
  WebviewTag
} from 'electron'
import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('WebviewHost')

interface Props {
  id: string
  src: string
  securityProfile: WebviewSecurityProfile
  reloadKey?: number | string
  allowPopups?: boolean
  openLinksExternal?: boolean
  userAgent?: string
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  testId?: string
  elementAttributes?: Readonly<Record<`data-${string}`, string>>
  onWebviewChange?: (webview: WebviewTag | null) => void
  onDomReady?: (webview: WebviewTag) => void
  onDidStartLoading?: () => void
  onDidStartNavigation?: (event: DidStartNavigationEvent) => void
  onDidFinishLoad?: () => void
  onReadyToShow?: () => void
  onDidNavigate?: (event: DidNavigateEvent | DidNavigateInPageEvent) => void
  onDidFailLoad?: (event: DidFailLoadEvent) => void
}

/**
 * Shared Electron WebView host. It owns only guest lifecycle and common WebView
 * preferences; product-specific chrome and persistence stay with each caller.
 */
export function WebviewHost({
  id,
  src,
  securityProfile,
  reloadKey,
  allowPopups = false,
  openLinksExternal = true,
  userAgent,
  className,
  style,
  ariaLabel,
  testId,
  elementAttributes,
  onWebviewChange,
  onDomReady,
  onDidStartLoading,
  onDidStartNavigation,
  onDidFinishLoad,
  onReadyToShow,
  onDidNavigate,
  onDidFailLoad
}: Props) {
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [webview, setWebview] = useState<WebviewTag | null>(null)
  const onWebviewChangeRef = useRef(onWebviewChange)
  const readyWebviewRef = useRef<WebviewTag | null>(null)
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
        void ipcApi
          .request('webview.set_open_link_external', { webviewId, isExternal: openLinksExternal })
          .catch((error) => logger.debug('Failed to update WebView link handling', { id, error }))
      } catch (error) {
        logger.debug('WebView is not ready for guest preferences', { id, error })
      }
    },
    [enableSpellCheck, id, openLinksExternal]
  )

  useEffect(() => {
    if (!webview) return

    const handleDomReady = () => {
      readyWebviewRef.current = webview
      applyGuestPreferences(webview)
      onDomReady?.(webview)
    }
    const handleStartLoading = () => {
      if (readyWebviewRef.current === webview) readyWebviewRef.current = null
      onDidStartLoading?.()
    }
    const handleNavigate = (event: DidNavigateEvent | DidNavigateInPageEvent) => onDidNavigate?.(event)

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-start-navigation', onDidStartNavigation ?? noop)
    webview.addEventListener('did-finish-load', onDidFinishLoad ?? noop)
    webview.addEventListener('ready-to-show', onReadyToShow ?? noop)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', onDidFailLoad ?? noop)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-start-navigation', onDidStartNavigation ?? noop)
      webview.removeEventListener('did-finish-load', onDidFinishLoad ?? noop)
      webview.removeEventListener('ready-to-show', onReadyToShow ?? noop)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', onDidFailLoad ?? noop)
      if (readyWebviewRef.current === webview) readyWebviewRef.current = null
    }
  }, [
    applyGuestPreferences,
    onDidFailLoad,
    onDidFinishLoad,
    onDidNavigate,
    onDidStartLoading,
    onDidStartNavigation,
    onDomReady,
    onReadyToShow,
    webview
  ])

  useEffect(() => {
    if (!webview) return
    const previous = loadedSourceRef.current
    loadedSourceRef.current = { reloadKey, src, webview }

    if (previous.webview !== webview || previous.src !== src) {
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
      key={securityProfile}
      {...elementAttributes}
      ref={handleRef}
      partition={getWebviewPartition(securityProfile)}
      useragent={userAgent}
      aria-label={ariaLabel}
      data-testid={testId}
      className={className}
      style={style}
    />
  )
}

function noop() {}
