import type { WebviewTag } from 'electron'
import { FileCode, Globe, LoaderCircle, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage, Button, Tooltip } from '@cherrystudio/ui'
import { BrowserChrome } from '@renderer/components/BrowserChrome'
import { BrowserOverlays } from '@renderer/components/BrowserOverlays'
import { buildTabCloseMenuItems, RightPaneTabs } from '@renderer/components/RightPaneTabs'
import { useSessionBrowserTabMenu } from '@renderer/components/useSessionBrowserTabMenu'
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
  target: WebviewAnnotationTarget
  isHostActive: boolean
  reloadKey?: number | string
  toolbarActions?: ReactNode
  header?: ReactNode
  onEmpty?: () => void
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

export function SessionBrowserView({
  runtime: browserRuntime = agentBrowserRuntimeService,
  ...props
}: SessionBrowserViewProps) {
  const { t } = useTranslation()
  const { sessionId, initialUrl, securityProfile, toolbarActions, onEmpty } = props
  const pages = useSyncExternalStore(browserRuntime.subscribe, () => browserRuntime.getPages(sessionId))
  const active = useSyncExternalStore(browserRuntime.subscribe, () => browserRuntime.get(sessionId))
  const tabPrefix = useId()
  useEffect(() => {
    if (browserRuntime.hasSession(sessionId)) return
    if (initialUrl === undefined && securityProfile === WebviewSecurityProfile.AgentBrowser)
      browserRuntime.openStartPage(sessionId)
    else browserRuntime.ensure(sessionId, initialUrl, securityProfile)
  }, [browserRuntime, sessionId, initialUrl, securityProfile])
  const title = (page: (typeof pages)[number]) =>
    page.title || (page.url === 'about:blank' ? t('webview.tabs.new') : page.url)
  const add = () => browserRuntime.openStartPage(sessionId)
  const closePages = (pageIds: readonly string[]) => {
    browserRuntime.closePages(sessionId, pageIds)
    if (browserRuntime.getPages(sessionId).length === 0) onEmpty?.()
  }
  const close = (pageId: string, focus: boolean) => {
    closePages([pageId])
    const next = browserRuntime.get(sessionId)
    if (focus && next)
      requestAnimationFrame(() => {
        document.getElementById(`${tabPrefix}-${next.pageId}`)?.focus()
      })
  }
  const getBrowserMenuItems = useSessionBrowserTabMenu({ runtime: browserRuntime, sessionId })
  const getMenuItems = (pageId: string) => [
    ...getBrowserMenuItems(pageId),
    { type: 'separator' as const },
    ...buildTabCloseMenuItems({
      keys: pages.map((page) => page.pageId),
      key: pageId,
      t,
      close: () => close(pageId, false),
      closeMany: closePages
    })
  ]
  const executing = pages.find((page) => page.executing)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {props.header === undefined ? (
        <div className="flex min-h-(--navbar-height) min-w-0 shrink-0 items-center gap-2 border-border-subtle border-b bg-card px-2">
          <RightPaneTabs
            tabs={pages.map((page) => ({
              key: page.pageId,
              title: title(page),
              path: `${title(page)} ${page.url}`,
              icon: page.loading ? (
                <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Avatar className="size-3.5 shrink-0 rounded-none">
                  <AvatarImage src={page.favicon} alt="" referrerPolicy="no-referrer" />
                  <AvatarFallback className="rounded-none bg-transparent">
                    {page.securityProfile === WebviewSecurityProfile.AgentHtmlArtifact ? (
                      <FileCode aria-hidden className="size-3.5" />
                    ) : (
                      <Globe aria-hidden className="size-3.5" />
                    )}
                  </AvatarFallback>
                </Avatar>
              ),
              status: page.executing ? (
                <span
                  role="status"
                  aria-label={t('webview.tabs.agent_active', { title: title(page) })}
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
              ) : undefined
            }))}
            activeKey={active?.pageId ?? null}
            label={t('webview.tabs.label')}
            closeLabel={(tab) => t('webview.tabs.close', { title: tab.title })}
            overflowLabel={t('webview.tabs.all')}
            tabIdPrefix={tabPrefix}
            panelId={`${tabPrefix}-content`}
            onActivate={(pageId) => browserRuntime.activate(sessionId, pageId)}
            onClose={close}
            getMenuItems={getMenuItems}
          />
          <Tooltip content={t('webview.tabs.new')}>
            <Button
              id={`${tabPrefix}-add`}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label={t('webview.tabs.new')}
              onClick={add}>
              <Plus className="size-3.5" />
            </Button>
          </Tooltip>
          {toolbarActions}
        </div>
      ) : (
        props.header
      )}
      {executing && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-border-subtle border-b px-3 py-1 text-muted-foreground text-xs">
          <span className="min-w-0 flex-1 truncate">{t('webview.tabs.agent_active', { title: title(executing) })}</span>
          {executing.pageId !== active?.pageId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => browserRuntime.activate(sessionId, executing.pageId)}>
              {t('webview.tabs.view')}
            </Button>
          )}
        </div>
      )}
      <div
        id={`${tabPrefix}-content`}
        role="tabpanel"
        aria-labelledby={active ? `${tabPrefix}-${active.pageId}` : undefined}
        className="min-h-0 flex-1">
        {active ? (
          <ActiveSessionBrowserView
            key={active.pageId}
            {...props}
            runtime={browserRuntime}
            pageId={active.pageId}
            toolbarActions={undefined}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
            <Globe className="size-6" />
            <p className="text-sm">{t('webview.tabs.empty')}</p>
            <Button variant="secondary" onClick={add}>
              <Plus className="size-4" />
              {t('webview.tabs.new')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function ActiveSessionBrowserView({
  runtime: browserRuntime,
  sessionId,
  pageId,
  target,
  isHostActive,
  reloadKey,
  onAnnotationSaved
}: SessionBrowserViewProps & { runtime: AgentBrowserRuntimeService; pageId: string }) {
  const { t } = useTranslation()
  const resource = useSyncExternalStore(browserRuntime.subscribe, () => browserRuntime.get(sessionId, pageId))
  useEffect(
    () => browserRuntime.update(sessionId, { reloadKey }, pageId),
    [browserRuntime, sessionId, pageId, reloadKey]
  )
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    browserRuntime.update(sessionId, { anchor: isHostActive ? anchor : null }, pageId)
    return () => browserRuntime.update(sessionId, { anchor: null }, pageId)
  }, [browserRuntime, sessionId, pageId, anchor, isHostActive])
  const webviewRef = useRef<WebviewTag | null>(null)
  const [webviewRevision, setWebviewRevision] = useState(0)
  useLayoutEffect(() => {
    webviewRef.current = resource?.guest ?? null
    setWebviewRevision((revision) => revision + 1)
  }, [resource?.guest])
  if (!resource) return null
  const pageTarget = { ...target, id: `${target.id}:${pageId}` }
  return (
    <BrowserChrome
      webviewRef={webviewRef}
      webviewRevision={webviewRevision}
      initialUrl={resource.url}
      pageTitle={resource.title}
      historyEnabled={resource.securityProfile === WebviewSecurityProfile.AgentBrowser}
      onNavigate={(url) => browserRuntime.navigate(sessionId, pageId, url)}
      isWebviewReady={resource.ready}
      isHostActive={isHostActive}
      autoFocusAddress={resource.url === 'about:blank'}
      target={pageTarget}
      onAnnotationSaved={onAnnotationSaved}
      banner={resource.securityProfile === WebviewSecurityProfile.AgentBrowser && <WebviewImportBanner />}>
      <div ref={setAnchor} className="h-full w-full" />
      {resource.overlays &&
        createPortal(
          <BrowserOverlays
            webviewRef={webviewRef}
            targetId={pageTarget.id}
            isReady={resource.ready}
            isLoading={resource.loading}
            errorMessage={
              resource.failed
                ? t(
                    resource.securityProfile === WebviewSecurityProfile.AgentHtmlArtifact
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
