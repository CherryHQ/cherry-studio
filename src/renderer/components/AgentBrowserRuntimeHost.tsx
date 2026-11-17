import type { WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useSyncExternalStore } from 'react'

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useDataChange } from '@renderer/data/hooks/useDataChange'
import { useAgentBrowserGuest } from '@renderer/hooks/agent/useAgentBrowserGuest'
import { useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import {
  agentBrowserRuntimeService,
  topicBrowserRuntimeService,
  type AgentBrowserRuntimeService
} from '@renderer/services/AgentBrowserRuntimeService'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import { getGuestAuthorizationKey } from '@renderer/utils/webviewGuest'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import { getWebviewPartition } from '@shared/utils/webviewSecurity'

import { BrowserCursorOverlay } from './BrowserCursorOverlay'
import { WebviewHost } from './WebviewHost'
import { WebviewSurface } from './WebviewSurface'

const logger = loggerService.withContext('AgentBrowserRuntimeHost')

function clearMessageSelection(): void {
  const messages = document.getElementById('messages')
  const selection = window.getSelection()
  if (!messages || !selection || selection.isCollapsed) return

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (!selection.getRangeAt(index).intersectsNode(messages)) continue
    selection.removeAllRanges()
    return
  }
}

/** Window composition mounts this outside page Activity; the runtime owns its instances. */
export function AgentBrowserRuntimeHost() {
  useIpcOn('browser.guest.ensure_requested', ({ sessionId, url, scope, pageId, action, activate }) => {
    const runtime = scope === 'topic' ? topicBrowserRuntimeService : agentBrowserRuntimeService
    if (action === 'navigate') runtime.navigate(sessionId, pageId, url ?? 'about:blank')
    else runtime.openPage(sessionId, url, undefined, { pageId, activate })
  })
  useIpcOn('browser.pane.open_requested', ({ sessionId, scope, pageId }) => {
    if (pageId)
      (scope === 'topic' ? topicBrowserRuntimeService : agentBrowserRuntimeService).activate(sessionId, pageId)
  })
  useIpcOn('browser.page.execution', ({ sessionId, scope, pageId, tabId, executing, webviewId }) => {
    const runtime = scope === 'topic' ? topicBrowserRuntimeService : agentBrowserRuntimeService
    const page = runtime.get(sessionId, pageId)
    if (page?.guest && (page.bindingId === tabId || (!page.bindingId && page.guest.getWebContentsId() === webviewId)))
      runtime.update(sessionId, { executing, bindingId: tabId }, pageId)
  })
  return (
    <>
      <BrowserRuntimeHost runtime={agentBrowserRuntimeService} />
      <BrowserRuntimeHost runtime={topicBrowserRuntimeService} scope="topic" />
    </>
  )
}

function BrowserRuntimeHost({ runtime, scope }: { runtime: AgentBrowserRuntimeService; scope?: 'topic' }) {
  const { tabs } = useTabs()
  const ids = useSyncExternalStore(runtime.subscribe, runtime.getIds)
  useEffect(() => {
    if (scope === 'topic') {
      const app = getSidebarApp('assistants')
      const owners = new Map<string, string>()
      for (const tab of tabs) {
        if (tab.type !== 'route' || !app || !tabBelongsToApp(app, tab.url)) continue
        const topicId = app.conversationRoute?.keyFromUrl(tab.url)
        if (topicId) owners.set(tab.id, topicId)
      }
      runtime.syncOwners(owners)
    } else {
      runtime.reconcileOwners(new Set(tabs.map((tab) => tab.id)))
    }
  }, [runtime, scope, tabs])
  useEffect(() => () => runtime.dispose(), [runtime])
  useDataChange('/agent-sessions', (effects) => {
    const changed = effects.filter((effect) => effect.kind === 'membership')
    if (!changed.length) return
    if (scope) return
    for (const sessionId of runtime.getIds()) {
      if (!changed.some((effect) => !effect.entityIds || effect.entityIds.includes(sessionId))) continue
      void dataApiService.get(`/agent-sessions/${sessionId}`).catch((error) => {
        if (isDataApiNotFoundError(error)) runtime.close(sessionId)
        else logger.debug('Failed to check browser session owner', { sessionId, error })
      })
    }
  })
  useDataChange('/topics', (effects) => {
    if (!scope || !effects.some((effect) => effect.kind === 'membership')) return
    for (const sessionId of runtime.getIds()) {
      void dataApiService.get(`/topics/${sessionId}`).catch((error) => {
        if (isDataApiNotFoundError(error)) runtime.close(sessionId)
        else logger.debug('Failed to check browser topic owner', { sessionId, error })
      })
    }
  })

  return ids.map((sessionId) => (
    <BrowserSessionGuests key={sessionId} sessionId={sessionId} runtime={runtime} scope={scope} />
  ))
}

function BrowserSessionGuests({
  sessionId,
  runtime,
  scope
}: {
  sessionId: string
  runtime: AgentBrowserRuntimeService
  scope?: 'topic'
}) {
  const pages = useSyncExternalStore(runtime.subscribe, () => runtime.getPages(sessionId))
  return pages.map((page) => (
    <AgentBrowserGuest key={page.pageId} pageId={page.pageId} sessionId={sessionId} runtime={runtime} scope={scope} />
  ))
}

const AgentBrowserGuest = memo(function AgentBrowserGuest({
  sessionId,
  pageId,
  runtime,
  scope
}: {
  sessionId: string
  pageId: string
  runtime: AgentBrowserRuntimeService
  scope?: 'topic'
}) {
  const resource = useSyncExternalStore(runtime.subscribe, () => runtime.get(sessionId, pageId))
  const guest = resource?.guest ?? null
  const tabId = useAgentBrowserGuest(sessionId, guest, 0, scope, pageId)
  useEffect(() => runtime.update(sessionId, { bindingId: tabId }, pageId), [runtime, sessionId, pageId, tabId])
  const onWebviewChange = useCallback(
    (webview: WebviewTag | null) =>
      runtime.update(
        sessionId,
        { guest: webview, ready: false, title: '', favicon: undefined, bindingId: undefined, executing: false },
        pageId
      ),
    [runtime, sessionId, pageId]
  )
  const onOverlaysChange = useCallback(
    (overlays: HTMLDivElement | null) => runtime.update(sessionId, { overlays }, pageId),
    [runtime, sessionId, pageId]
  )
  if (!resource) return null
  const { sourceUrl, securityProfile, anchor } = resource
  const authorization = getGuestAuthorizationKey(securityProfile, sourceUrl)
  return (
    <WebviewSurface
      anchor={anchor}
      guest={
        <WebviewHost
          key={authorization}
          id={`agent-browser:${sessionId}:${pageId}`}
          src={sourceUrl}
          reloadKey={resource.reloadKey}
          partition={getWebviewPartition(securityProfile)}
          allowPopups
          className="inline-flex h-full w-full bg-white"
          testId="webview-browser-guest"
          onWebviewChange={onWebviewChange}
          onDomReady={(webview) =>
            runtime.update(
              sessionId,
              { ready: true, loading: webview.isLoading(), url: webview.getURL(), title: webview.getTitle() },
              pageId
            )
          }
          onDidStartLoading={() => runtime.update(sessionId, { loading: true, failed: false }, pageId)}
          onDidFinishLoad={() => runtime.update(sessionId, { ready: true, loading: false }, pageId)}
          onDidStopLoading={() => runtime.update(sessionId, { loading: false }, pageId)}
          onDidStartNavigation={(event) => {
            if (event.isMainFrame && !event.isInPlace)
              runtime.update(sessionId, { title: '', favicon: undefined }, pageId)
          }}
          onDidNavigate={(event) => {
            if (!('isMainFrame' in event) || event.isMainFrame) runtime.update(sessionId, { url: event.url }, pageId)
          }}
          onPageTitleUpdated={(event) => runtime.update(sessionId, { title: event.title }, pageId)}
          onPageFaviconUpdated={(event) =>
            runtime.update(
              sessionId,
              { favicon: event.favicons.find((url) => /^https?:\/\//i.test(url) || url.startsWith('data:image/')) },
              pageId
            )
          }
          onDidFailLoad={(event) => {
            if (event.isMainFrame && event.errorCode !== -3)
              runtime.update(sessionId, { failed: true, ready: true, loading: false }, pageId)
          }}
        />
      }
      overlay={
        <>
          {tabId && guest && (
            <BrowserCursorOverlay
              key={tabId}
              scope={scope}
              sessionId={sessionId}
              tabId={tabId}
              guest={guest}
              active={!!anchor && resource.ready && !resource.failed}
              onPressed={clearMessageSelection}
            />
          )}
          <div ref={onOverlaysChange} className="contents" />
        </>
      }
    />
  )
})
