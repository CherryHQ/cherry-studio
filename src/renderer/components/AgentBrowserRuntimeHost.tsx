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
  useIpcOn('browser.guest.ensure_requested', ({ sessionId, url, scope }) => {
    const runtime = scope === 'topic' ? topicBrowserRuntimeService : agentBrowserRuntimeService
    runtime.ensure(sessionId, url)
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
    <AgentBrowserGuest key={sessionId} sessionId={sessionId} runtime={runtime} scope={scope} />
  ))
}

const AgentBrowserGuest = memo(function AgentBrowserGuest({
  sessionId,
  runtime,
  scope
}: {
  sessionId: string
  runtime: AgentBrowserRuntimeService
  scope?: 'topic'
}) {
  const resource = useSyncExternalStore(runtime.subscribe, () => runtime.get(sessionId))
  const guest = resource?.guest ?? null
  const tabId = useAgentBrowserGuest(sessionId, guest, 0, scope)
  const onWebviewChange = useCallback(
    (webview: WebviewTag | null) => runtime.update(sessionId, { guest: webview, ready: false, title: '' }),
    [runtime, sessionId]
  )
  const onOverlaysChange = useCallback(
    (overlays: HTMLDivElement | null) => runtime.update(sessionId, { overlays }),
    [runtime, sessionId]
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
          id={`agent-browser:${sessionId}`}
          src={sourceUrl}
          reloadKey={resource.reloadKey}
          partition={getWebviewPartition(securityProfile)}
          allowPopups
          className="inline-flex h-full w-full bg-white"
          testId="webview-browser-guest"
          onWebviewChange={onWebviewChange}
          onDomReady={(webview) =>
            runtime.update(sessionId, { ready: true, url: webview.getURL(), title: webview.getTitle() })
          }
          onDidStartLoading={() => runtime.update(sessionId, { loading: true, failed: false })}
          onDidFinishLoad={() => runtime.update(sessionId, { ready: true, loading: false })}
          onDidNavigate={(event) => {
            if (!('isMainFrame' in event) || event.isMainFrame) runtime.update(sessionId, { url: event.url })
          }}
          onPageTitleUpdated={(event) => runtime.update(sessionId, { title: event.title })}
          onDidFailLoad={(event) => {
            if (event.isMainFrame && event.errorCode !== -3)
              runtime.update(sessionId, { failed: true, ready: true, loading: false })
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
