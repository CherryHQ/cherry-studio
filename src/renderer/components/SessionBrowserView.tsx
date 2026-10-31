import type { WebviewTag } from 'electron'
import { RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { BrowserChrome } from '@renderer/components/BrowserChrome'
import { BrowserOverlays } from '@renderer/components/BrowserOverlays'
import type { WebviewAnnotationSavedPayload } from '@renderer/components/WebviewAnnotationControls'
import { WebviewImportBanner } from '@renderer/components/WebviewImportBanner'
import {
  agentBrowserRuntimeService,
  type AgentBrowserRuntimeService
} from '@renderer/services/AgentBrowserRuntimeService'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

export interface SessionBrowserViewProps {
  runtime?: AgentBrowserRuntimeService
  sessionId: string
  initialUrl?: string
  securityProfile: WebviewSecurityProfile
  onNavigate: (url: string) => void
  target: WebviewAnnotationTarget
  isHostActive: boolean
  reloadKey?: number | string
  toolbarActions?: ReactNode
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

export function SessionBrowserView({
  runtime: browserRuntime = agentBrowserRuntimeService,
  sessionId,
  initialUrl,
  securityProfile,
  onNavigate,
  target,
  isHostActive,
  reloadKey,
  toolbarActions,
  onAnnotationSaved
}: SessionBrowserViewProps) {
  const { t } = useTranslation()
  const resource = useSyncExternalStore(browserRuntime.subscribe, () => browserRuntime.get(sessionId))
  const configuredSource = useRef<string | undefined>(undefined)
  useEffect(() => {
    const key = `${sessionId}:${securityProfile}:${initialUrl}`
    if (configuredSource.current !== key || !browserRuntime.get(sessionId)) {
      configuredSource.current = key
      browserRuntime.ensure(sessionId, initialUrl, securityProfile)
    }
  }, [browserRuntime, sessionId, initialUrl, securityProfile])
  useEffect(() => {
    browserRuntime.update(sessionId, { reloadKey })
  }, [browserRuntime, sessionId, reloadKey, resource?.sessionId])
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    browserRuntime.update(sessionId, { anchor: isHostActive ? anchor : null })
    return () => browserRuntime.update(sessionId, { anchor: null })
  }, [browserRuntime, sessionId, anchor, isHostActive, resource?.sessionId])
  const webviewRef = useRef<WebviewTag | null>(null)
  const [webviewRevision, setWebviewRevision] = useState(0)
  useLayoutEffect(() => {
    webviewRef.current = resource?.guest ?? null
    setWebviewRevision((revision) => revision + 1)
  }, [resource?.guest])
  const activeProfile = resource?.securityProfile ?? securityProfile
  const isReady = (resource?.ready ?? false) && !resource?.recoveryReason
  const recovery = resource?.recoveryReason
    ? {
        message: t(
          resource.recoveryReason === 'render-process-gone'
            ? 'webview.browser.process_gone'
            : 'webview.browser.unresponsive'
        ),
        onRecover: () => void browserRuntime.recover(sessionId)
      }
    : undefined

  return (
    <BrowserChrome
      webviewRef={webviewRef}
      webviewRevision={webviewRevision}
      initialUrl={resource?.url ?? initialUrl ?? 'about:blank'}
      pageTitle={resource?.title ?? ''}
      historyEnabled={activeProfile === WebviewSecurityProfile.AgentBrowser}
      onNavigate={onNavigate}
      isWebviewReady={isReady}
      canReload={isReady || !!resource?.recoveryReason}
      onReload={recovery?.onRecover}
      isHostActive={isHostActive}
      target={target}
      onAnnotationSaved={onAnnotationSaved}
      toolbarActions={
        <>
          <Tooltip content={t('webview.browser.reset_page')} placement="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded text-muted-foreground shadow-none active:scale-95 hover:text-foreground disabled:cursor-default disabled:active:scale-100 disabled:hover:bg-transparent"
              aria-label={t('webview.browser.reset_page')}
              disabled={!resource?.guest}
              onClick={() => void browserRuntime.recover(sessionId)}>
              <RotateCcw size={14} />
            </Button>
          </Tooltip>
          {toolbarActions}
        </>
      }
      banner={activeProfile === WebviewSecurityProfile.AgentBrowser && <WebviewImportBanner />}>
      <div ref={setAnchor} className="h-full w-full" />
      {resource?.overlays &&
        createPortal(
          <BrowserOverlays
            webviewRef={webviewRef}
            targetId={target.id}
            isReady={isReady}
            isLoading={resource.loading}
            recovery={recovery}
            errorMessage={
              resource.failed
                ? t(
                    activeProfile === WebviewSecurityProfile.AgentHtmlArtifact
                      ? 'webview.navigation.load_failed'
                      : 'webview.browser.load_failed'
                  )
                : undefined
            }
          />,
          resource.overlays
        )}
    </BrowserChrome>
  )
}
