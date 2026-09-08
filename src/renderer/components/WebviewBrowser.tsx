import { useAgentBrowserGuest } from '@renderer/hooks/agent/useAgentBrowserGuest'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  DidStartNavigationEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag
} from 'electron'
import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WebviewAnnotationSavedPayload } from './WebviewAnnotationControls'
import { WebviewHost } from './WebviewHost'
import { WebviewImportBanner } from './WebviewImportBanner'
import { WebviewNavigation } from './WebviewNavigation'
import WebviewSearch from './WebviewSearch'

interface Props {
  initialUrl: string
  securityProfile:
    | typeof WebviewSecurityProfile.AgentBrowser
    | typeof WebviewSecurityProfile.AgentDevPreview
    | typeof WebviewSecurityProfile.AgentHtmlArtifact
  agentSessionId?: string
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

/** A shared browser surface for Agent previews and explicitly opened HTML artifacts. */
export function WebviewBrowser({
  initialUrl: sourceUrl,
  agentSessionId,
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
    sourceUrl: string
    sourceProfile: Props['securityProfile']
    url: string
  }>()
  const hasNavigation = navigation?.sourceUrl === sourceUrl && navigation.sourceProfile === sourceProfile
  const initialUrl = hasNavigation ? navigation.url : sourceUrl
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
  useAgentBrowserGuest(agentSessionId, webviewRef.current, webviewRevision)
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <WebviewNavigation
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
      />
      {securityProfile === WebviewSecurityProfile.AgentBrowser && <WebviewImportBanner />}
      <div className="relative min-h-0 flex-1 bg-white">
        <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} targetId={target.id} />
        <WebviewHost
          key={`${agentSessionId ?? ''}:${guestAuthorizationKey}`}
          id={target.id}
          src={initialUrl}
          partition={getWebviewPartition(securityProfile)}
          allowPopups={!!agentSessionId || securityProfile === WebviewSecurityProfile.AgentBrowser}
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
        {isLoading && !isReady ? (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-sm">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            <span>{t('webview.browser.loading')}</span>
          </div>
        ) : null}
        {loadFailed ? (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-muted-foreground text-sm">
            {t(
              securityProfile === WebviewSecurityProfile.AgentHtmlArtifact
                ? 'webview.navigation.load_failed'
                : 'webview.browser.load_failed'
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getGuestAuthorizationKey(securityProfile: Props['securityProfile'], initialUrl: string): string {
  if (securityProfile === WebviewSecurityProfile.AgentBrowser) return securityProfile
  if (securityProfile === WebviewSecurityProfile.AgentHtmlArtifact) return `${securityProfile}:${initialUrl}`
  if (initialUrl === 'about:blank') return `${securityProfile}:${initialUrl}`

  try {
    const url = new URL(initialUrl)
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
    return `${securityProfile}:${url.origin}`
  } catch {
    return `${securityProfile}:${initialUrl}`
  }
}
