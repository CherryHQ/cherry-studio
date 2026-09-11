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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { agentBrowserRuntimeService as browserRuntime } from '@renderer/services/AgentBrowserRuntimeService'
import { getGuestAuthorizationKey } from '@renderer/utils/webviewGuest'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

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
  const resource = useSyncExternalStore(browserRuntime.subscribe, () =>
    agentSessionId ? browserRuntime.get(agentSessionId) : undefined
  )
  const configuredSource = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!agentSessionId) return
    const key = `${agentSessionId}:${securityProfile}:${initialUrl}`
    if (configuredSource.current !== key || !browserRuntime.get(agentSessionId)) {
      configuredSource.current = key
      browserRuntime.ensure(agentSessionId, initialUrl, securityProfile)
    }
  }, [agentSessionId, initialUrl, securityProfile])
  useEffect(() => {
    if (agentSessionId) browserRuntime.update(agentSessionId, { reloadKey })
  }, [agentSessionId, reloadKey, resource?.sessionId])
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!agentSessionId) return
    browserRuntime.update(agentSessionId, { anchor: isHostActive ? anchor : null })
    return () => browserRuntime.update(agentSessionId, { anchor: null })
  }, [agentSessionId, anchor, isHostActive, resource?.sessionId])
  useLayoutEffect(() => {
    if (!agentSessionId) return
    webviewRef.current = resource?.guest ?? null
    setWebviewRevision((revision) => revision + 1)
  }, [agentSessionId, resource?.guest])
  const [localReady, setIsReady] = useState(false)
  const [localLoading, setIsLoading] = useState(true)
  const [localFailed, setLoadFailed] = useState(false)
  const [localTitle, setPageTitle] = useState('')
  const isReady = agentSessionId ? (resource?.ready ?? false) : localReady
  const isLoading = agentSessionId ? (resource?.loading ?? true) : localLoading
  const loadFailed = agentSessionId ? (resource?.failed ?? false) : localFailed
  const pageTitle = agentSessionId ? (resource?.title ?? '') : localTitle
  const activeProfile = resource?.securityProfile ?? securityProfile
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

  const overlays = (
    <>
      <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} targetId={target.id} />
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
            activeProfile === WebviewSecurityProfile.AgentHtmlArtifact
              ? 'webview.navigation.load_failed'
              : 'webview.browser.load_failed'
          )}
        </div>
      ) : null}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <WebviewNavigation
        webviewRef={webviewRef}
        webviewRevision={webviewRevision}
        initialUrl={resource?.url ?? initialUrl}
        pageTitle={pageTitle}
        historyEnabled={activeProfile === WebviewSecurityProfile.AgentBrowser}
        onNavigate={handleNavigate}
        isWebviewReady={isReady}
        isHostActive={isHostActive}
        target={target}
        onAnnotationSaved={onAnnotationSaved}
        toolbarActions={toolbarActions}
      />
      {activeProfile === WebviewSecurityProfile.AgentBrowser && <WebviewImportBanner />}
      <div className="relative min-h-0 flex-1 bg-white">
        {agentSessionId ? (
          <div ref={setAnchor} className="h-full w-full" />
        ) : (
          <WebviewHost
            key={`${agentSessionId ?? ''}:${guestAuthorizationKey}`}
            id={target.id}
            src={initialUrl}
            securityProfile={securityProfile}
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
        )}
        {agentSessionId ? (resource?.overlays ? createPortal(overlays, resource.overlays) : null) : overlays}
      </div>
    </div>
  )
}
