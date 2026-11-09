import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  DidStartNavigationEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag
} from 'electron'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cacheService } from '@renderer/data/CacheService'
import { preferenceService } from '@renderer/data/PreferenceService'
import { ipcApi } from '@renderer/ipc'
import { getGuestAuthorizationKey } from '@renderer/utils/webviewGuest'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserChrome } from './BrowserChrome'
import { BrowserOverlays } from './BrowserOverlays'
import type { WebviewAnnotationSavedPayload } from './WebviewAnnotationControls'
import { WebviewHost } from './WebviewHost'
import { WebviewImportBanner } from './WebviewImportBanner'

interface Props {
  initialUrl?: string
  startPageContext?: string
  securityProfile:
    | typeof WebviewSecurityProfile.AgentBrowser
    | typeof WebviewSecurityProfile.AgentDevPreview
    | typeof WebviewSecurityProfile.AgentHtmlArtifact
  onNavigate?: (url: string) => void
  onUrlChange?: (url: string) => void
  onTitleChange?: (title: string) => void
  onFaviconChange?: (url: string | undefined) => void
  target: WebviewAnnotationTarget
  isHostActive: boolean
  reloadKey?: number | string
  toolbarActions?: ReactNode
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

/** A page-owned browser for standalone tabs and explicitly opened HTML artifacts. */
export function WebviewBrowser({
  initialUrl: sourceUrl,
  startPageContext,
  onNavigate,
  onUrlChange,
  onTitleChange,
  onFaviconChange,
  securityProfile: sourceProfile,
  target,
  isHostActive,
  reloadKey,
  toolbarActions,
  onAnnotationSaved
}: Props) {
  const { t } = useTranslation()
  const [navigation, setNavigation] = useState<{
    sourceUrl: string | undefined
    sourceProfile: Props['securityProfile']
    url: string
  }>()
  const hasNavigation = navigation && navigation.sourceUrl === sourceUrl && navigation.sourceProfile === sourceProfile
  const requestedUrl = hasNavigation ? navigation.url : sourceUrl
  const [startPageUrl] = useState(() => {
    if (
      requestedUrl !== undefined ||
      startPageContext === undefined ||
      sourceProfile !== WebviewSecurityProfile.AgentBrowser
    )
      return 'about:blank'
    const mode = preferenceService.getCachedValue('app.browser.start_page.mode')
    let url: unknown
    if (mode === 'custom') url = preferenceService.getCachedValue('app.browser.start_page.custom_url')
    else if (mode === 'last') {
      const urls = cacheService.getPersist('ui.browser.last_urls')
      if (urls && typeof urls === 'object' && !Array.isArray(urls)) url = urls[startPageContext]
    }
    try {
      return typeof url === 'string' ? normalizeBrowserUrl(url) : 'about:blank'
    } catch {
      return 'about:blank'
    }
  })
  const initialUrl = requestedUrl ?? startPageUrl
  const securityProfile = initialUrl.startsWith('file:')
    ? WebviewSecurityProfile.AgentHtmlArtifact
    : hasNavigation
      ? WebviewSecurityProfile.AgentBrowser
      : sourceProfile
  const handleNavigate = useCallback(
    (url: string) => {
      if (onNavigate) onNavigate(url)
      else setNavigation({ sourceUrl, sourceProfile, url })
    },
    [onNavigate, sourceUrl, sourceProfile]
  )
  const webviewRef = useRef<WebviewTag | null>(null)
  const [webviewRevision, setWebviewRevision] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pageTitle, setPageTitle] = useState('')
  const guestAuthorizationKey = getGuestAuthorizationKey(securityProfile, initialUrl)

  // An <Activity>-hidden tab runs this cleanup too: main freezes a guest left hidden.
  useEffect(() => {
    const webview = webviewRef.current
    if (!isHostActive || !webview) return
    let webviewId: number
    try {
      webviewId = webview.getWebContentsId()
    } catch {
      return // A new guest has no contents until dom-ready, which re-runs this effect.
    }
    const report = (visible: boolean) =>
      void ipcApi.request('webview.set_visible', { webviewId, visible }).catch(() => {})
    report(true)
    return () => report(false)
  }, [isHostActive, isReady, webviewRevision])

  const handleWebviewChange = useCallback((webview: WebviewTag | null) => {
    webviewRef.current = webview
    setWebviewRevision((revision) => revision + 1)
    if (!webview) {
      setIsReady(false)
      setPageTitle('')
    }
  }, [])

  const handleDidStartLoading = useCallback(() => {
    setIsLoading(true)
    setLoadFailed(false)
  }, [])

  const handleDomReady = useCallback(
    (guest: WebviewTag) => {
      setIsReady(true)
      const title = guest.getTitle()
      setPageTitle(title)
      onTitleChange?.(title || guest.getURL())
    },
    [onTitleChange]
  )

  const handleDidStartNavigation = useCallback(
    (event: DidStartNavigationEvent) => {
      if (!event.isMainFrame || event.isInPlace) return
      setPageTitle('')
      onTitleChange?.(event.url)
      onFaviconChange?.(undefined)
    },
    [onTitleChange, onFaviconChange]
  )

  const handleDidNavigate = useCallback(
    (event: DidNavigateEvent | DidNavigateInPageEvent) => {
      if ('isMainFrame' in event && !event.isMainFrame) return
      if (startPageContext !== undefined && securityProfile === WebviewSecurityProfile.AgentBrowser) {
        let url: string | undefined
        try {
          url = normalizeBrowserUrl(event.url)
        } catch {
          // Blank and artifact destinations must leave remembered HTTP(S) history intact.
        }
        // Remembering powers last mode, so it must not run before the user opts in.
        if (url !== undefined && preferenceService.getCachedValue('app.browser.start_page.mode') === 'last') {
          cacheService.setPersist('ui.browser.last_urls', (urls) => ({
            ...(urls && typeof urls === 'object' && !Array.isArray(urls) ? urls : {}),
            [startPageContext]: url
          }))
        }
      }
      onUrlChange?.(event.url)
    },
    [onUrlChange, securityProfile, startPageContext]
  )

  const handlePageTitleUpdated = useCallback(
    (event: PageTitleUpdatedEvent) => {
      setPageTitle(event.title)
      onTitleChange?.(event.title || webviewRef.current?.getURL() || initialUrl)
    },
    [initialUrl, onTitleChange]
  )

  const handlePageFaviconUpdated = useCallback(
    (event: PageFaviconUpdatedEvent) => {
      onFaviconChange?.(event.favicons.find((url) => /^https?:\/\//i.test(url) || url.startsWith('data:image/')))
    },
    [onFaviconChange]
  )

  const handleDidFinishLoad = useCallback(() => {
    setIsReady(true)
    setIsLoading(false)
  }, [])

  const handleDidFailLoad = useCallback((event: DidFailLoadEvent) => {
    if (!event.isMainFrame || event.errorCode === -3) return
    setIsReady(true)
    setIsLoading(false)
    setLoadFailed(true)
  }, [])

  return (
    <BrowserChrome
      webviewRef={webviewRef}
      webviewRevision={webviewRevision}
      initialUrl={initialUrl}
      pageTitle={pageTitle}
      historyEnabled={securityProfile === WebviewSecurityProfile.AgentBrowser}
      onNavigate={handleNavigate}
      isWebviewReady={isReady}
      isHostActive={isHostActive}
      target={target}
      onAnnotationSaved={onAnnotationSaved}
      toolbarActions={toolbarActions}
      banner={securityProfile === WebviewSecurityProfile.AgentBrowser && <WebviewImportBanner />}>
      <WebviewHost
        key={guestAuthorizationKey}
        id={target.id}
        src={initialUrl}
        partition={getWebviewPartition(securityProfile)}
        allowPopups={securityProfile === WebviewSecurityProfile.AgentBrowser}
        reloadKey={reloadKey}
        ariaLabel={target.label}
        testId="webview-browser-guest"
        className="inline-flex h-full w-full bg-white"
        onWebviewChange={handleWebviewChange}
        onDomReady={handleDomReady}
        onDidStartLoading={handleDidStartLoading}
        onDidStartNavigation={handleDidStartNavigation}
        onDidNavigate={handleDidNavigate}
        onPageTitleUpdated={handlePageTitleUpdated}
        onPageFaviconUpdated={handlePageFaviconUpdated}
        onDidFinishLoad={handleDidFinishLoad}
        onDidFailLoad={handleDidFailLoad}
      />
      <BrowserOverlays
        webviewRef={webviewRef}
        targetId={target.id}
        isReady={isReady}
        isLoading={isLoading}
        errorMessage={
          loadFailed
            ? t(
                securityProfile === WebviewSecurityProfile.AgentHtmlArtifact
                  ? 'webview.navigation.load_failed'
                  : 'webview.browser.load_failed'
              )
            : undefined
        }
      />
    </BrowserChrome>
  )
}
