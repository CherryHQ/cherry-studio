import type { WebviewTag } from 'electron'
import { FileCode, Globe, LoaderCircle, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage, Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { BrowserChrome } from '@renderer/components/BrowserChrome'
import { BrowserOverlays } from '@renderer/components/BrowserOverlays'
import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import { RightPaneTabs } from '@renderer/components/RightPaneTabs'
import type { WebviewAnnotationSavedPayload } from '@renderer/components/WebviewAnnotationControls'
import { WebviewImportBanner } from '@renderer/components/WebviewImportBanner'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import {
  agentBrowserRuntimeService,
  type AgentBrowserRuntimeService
} from '@renderer/services/AgentBrowserRuntimeService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import type { WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'
import { isHttpUrl } from '@shared/utils/url'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

const logger = loggerService.withContext('SessionBrowserView')

export interface SessionBrowserViewProps {
  runtime?: AgentBrowserRuntimeService
  sessionId: string
  initialUrl?: string
  securityProfile: WebviewSecurityProfile
  target: WebviewAnnotationTarget
  isHostActive: boolean
  reloadKey?: number | string
  toolbarActions?: ReactNode
  onEmpty?: () => void
  onAnnotationSaved?: (payload: WebviewAnnotationSavedPayload) => void
}

export function SessionBrowserView({
  runtime: browserRuntime = agentBrowserRuntimeService,
  ...props
}: SessionBrowserViewProps) {
  const { t } = useTranslation()
  const { sessionId, initialUrl, securityProfile, toolbarActions, onEmpty } = props
  const tabs = useOptionalTabsContext()
  const frame = useWindowFrame()
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
  const getMenuItems = (pageId: string): readonly CommandContextMenuExtraItem[] => {
    const page = browserRuntime.get(sessionId, pageId)
    if (!page) return []
    const pages = browserRuntime.getPages(sessionId)
    const openElsewhere = (destination: 'tab' | 'window') => {
      const current = browserRuntime.get(sessionId, pageId)
      if (!current) return
      const url = `/app/browser?${new URLSearchParams({ url: current.url })}`
      if (destination === 'window') {
        void ipcApi
          .request('tab.detach', { id: crypto.randomUUID(), url, title: title(current), type: 'route' })
          .catch((error) => logger.error('Failed to open browser tab in a new window', error))
      } else if (tabs && frame.mode === 'embedded') {
        tabs.openTab(url, { title: title(current), forceNew: true })
      } else {
        openRoute('/app/browser', { url: current.url })
      }
    }
    const closeGroup = (group: 'others' | 'right' | 'all') => {
      const current = browserRuntime.getPages(sessionId)
      const index = current.findIndex((entry) => entry.pageId === pageId)
      if (index < 0) return
      const targets = group === 'right' ? current.slice(index + 1) : current
      closePages(targets.filter((entry) => group !== 'others' || entry.pageId !== pageId).map((entry) => entry.pageId))
    }
    return [
      {
        type: 'item',
        id: 'browser.tab.open-new-tab',
        label: t('common.open_in_new_tab'),
        onSelect: () => openElsewhere('tab')
      },
      {
        type: 'item',
        id: 'browser.tab.open-new-window',
        label: t('tab.open_in_new_window'),
        onSelect: () => openElsewhere('window')
      },
      {
        type: 'item',
        id: 'browser.tab.copy-link',
        label: t('webview.tabs.copy_link'),
        enabled: page.url !== 'about:blank',
        onSelect: () => {
          const current = browserRuntime.get(sessionId, pageId)
          if (!current || current.url === 'about:blank') return
          void navigator.clipboard.writeText(current.url).then(
            () => toast.success(t('message.copy.success')),
            (error) => {
              logger.error('Failed to copy browser tab link', error)
              toast.error(t('common.copy_failed'))
            }
          )
        }
      },
      {
        type: 'item',
        id: 'browser.tab.open-external',
        label: t('webview.navigation.open_external'),
        enabled: isHttpUrl(page.url),
        onSelect: () => {
          const current = browserRuntime.get(sessionId, pageId)
          if (current && isHttpUrl(current.url))
            void openExternalWebsite(current.url).catch((error) =>
              logger.error('Failed to open browser tab externally', error)
            )
        }
      },
      { type: 'separator' },
      { type: 'item', id: 'browser.tab.close', label: t('tab.close'), onSelect: () => close(pageId, false) },
      {
        type: 'item',
        id: 'browser.tab.close-others',
        label: t('tab.close_others'),
        enabled: pages.length > 1,
        onSelect: () => closeGroup('others')
      },
      {
        type: 'item',
        id: 'browser.tab.close-right',
        label: t('tab.close_to_right'),
        enabled: pages.at(-1)?.pageId !== pageId,
        onSelect: () => closeGroup('right')
      },
      {
        type: 'item',
        id: 'browser.tab.close-all',
        label: t('webview.tabs.close_all'),
        onSelect: () => closeGroup('all')
      }
    ]
  }
  const executing = pages.find((page) => page.executing)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
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
