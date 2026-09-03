import type { WebviewAnnotationTarget } from '@shared/types/webview'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import type { DidFailLoadEvent, WebviewTag } from 'electron'
import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WebviewAnnotationSavedPayload } from './WebviewAnnotationControls'
import { WebviewHost } from './WebviewHost'
import { WebviewNavigation } from './WebviewNavigation'
import WebviewSearch from './WebviewSearch'

interface Props {
  initialUrl: string
  securityProfile: typeof WebviewSecurityProfile.AgentDevPreview | typeof WebviewSecurityProfile.AgentHtmlArtifact
  target: WebviewAnnotationTarget
  isHostActive: boolean
  reloadKey?: number | string
  toolbarActions?: ReactNode
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

/** A shared browser surface for Agent previews and explicitly opened HTML artifacts. */
export function WebviewBrowser({
  initialUrl,
  securityProfile,
  target,
  isHostActive,
  reloadKey,
  toolbarActions,
  onAnnotationSaved
}: Props) {
  const { t } = useTranslation()
  const webviewRef = useRef<WebviewTag | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const guestAuthorizationKey = getGuestAuthorizationKey(securityProfile, initialUrl)

  const handleWebviewChange = useCallback((webview: WebviewTag | null) => {
    webviewRef.current = webview
    if (!webview) setIsReady(false)
  }, [])

  const handleDidStartLoading = useCallback(() => {
    setIsLoading(true)
    setLoadFailed(false)
  }, [])

  const handleDomReady = useCallback(() => {
    setIsReady(true)
  }, [])

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
        initialUrl={initialUrl}
        isWebviewReady={isReady}
        isHostActive={isHostActive}
        target={target}
        onAnnotationSaved={onAnnotationSaved}
        toolbarActions={toolbarActions}
      />
      <div className="relative min-h-0 flex-1 bg-white">
        <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} targetId={target.id} />
        <WebviewHost
          key={guestAuthorizationKey}
          id={target.id}
          src={initialUrl}
          securityProfile={securityProfile}
          reloadKey={reloadKey}
          ariaLabel={target.label}
          testId="webview-browser-guest"
          className="inline-flex h-full w-full bg-white"
          onWebviewChange={handleWebviewChange}
          onDomReady={handleDomReady}
          onDidStartLoading={handleDidStartLoading}
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
            {t('webview.browser.load_failed')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getGuestAuthorizationKey(securityProfile: Props['securityProfile'], initialUrl: string): string {
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
