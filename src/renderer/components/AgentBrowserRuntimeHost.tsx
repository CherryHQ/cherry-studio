import type { WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

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
import { toast } from '@renderer/services/toast'
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
  useIpcOn('browser.guest.ensure_requested', ({ sessionId, url, scope, repair }) => {
    const runtime = scope === 'topic' ? topicBrowserRuntimeService : agentBrowserRuntimeService
    runtime.ensure(sessionId, url, undefined, repair)
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
  const { t } = useTranslation()
  const notified = useRef<string | undefined>(undefined)
  const tabId = useAgentBrowserGuest(
    sessionId,
    guest,
    resource?.bindingRevision ?? 0,
    scope,
    resource?.repair?.requestId,
    resource?.repair?.expiresAt
  )
  useEffect(() => {
    const repair = resource?.repair
    if (
      tabId &&
      repair?.kind === 'recreate' &&
      repair.expiresAt > Date.now() &&
      notified.current !== repair.requestId
    ) {
      notified.current = repair.requestId
      toast.warning(t('webview.browser.recreated'))
    }
  }, [tabId, resource?.repair, t])
  const onWebviewChange = useCallback(
    (webview: WebviewTag | null) => {
      if (runtime.get(sessionId)?.guestGeneration !== resource?.guestGeneration) return
      runtime.update(sessionId, { guest: webview, ready: false, title: '' })
    },
    [runtime, sessionId, resource?.guestGeneration]
  )
  const onOverlaysChange = useCallback(
    (overlays: HTMLDivElement | null) => runtime.update(sessionId, { overlays }),
    [runtime, sessionId]
  )
  if (!resource) return null
  const generation = resource.guestGeneration
  const updateCurrent = (patch: Parameters<typeof runtime.update>[1]) => {
    if (runtime.get(sessionId)?.guestGeneration === generation) runtime.update(sessionId, patch)
  }
  const { sourceUrl, securityProfile, anchor } = resource
  const authorization = getGuestAuthorizationKey(securityProfile, sourceUrl)
  return (
    <WebviewSurface
      anchor={anchor}
      guest={
        <WebviewHost
          key={`${authorization}:${resource.guestGeneration}`}
          id={`agent-browser:${sessionId}`}
          src={sourceUrl}
          reloadKey={resource.reloadKey}
          partition={getWebviewPartition(securityProfile)}
          allowPopups
          className="inline-flex h-full w-full bg-white"
          testId="webview-browser-guest"
          onWebviewChange={onWebviewChange}
          onDomReady={(webview) => updateCurrent({ ready: true, url: webview.getURL(), title: webview.getTitle() })}
          onDidStartLoading={() => updateCurrent({ loading: true, failed: false })}
          onDidFinishLoad={() => updateCurrent({ ready: true, loading: false })}
          onDidNavigate={(event) => {
            if (!('isMainFrame' in event) || event.isMainFrame) updateCurrent({ url: event.url })
          }}
          onPageTitleUpdated={(event) => updateCurrent({ title: event.title })}
          onDidFailLoad={(event) => {
            if (event.isMainFrame && event.errorCode !== -3)
              updateCurrent({ failed: true, ready: true, loading: false })
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
