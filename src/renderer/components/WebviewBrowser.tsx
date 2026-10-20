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
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getGuestAuthorizationKey } from '@renderer/utils/webviewGuest'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserChrome } from './BrowserChrome'
import { BrowserOverlays } from './BrowserOverlays'
import type { WebviewAnnotationSavedPayload } from './WebviewAnnotationControls'
import { WebviewHost } from './WebviewHost'
import { WebviewImportBanner } from './WebviewImportBanner'

interface Props {
  initialUrl?: string
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
  const initialUrl = requestedUrl ?? 'about:blank'
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
      onUrlChange?.(event.url)
    },
    [onUrlChange]
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
