import type { WebviewTag } from 'electron'
import { memo, useCallback, useEffect, useSyncExternalStore } from 'react'

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { useDataChange } from '@renderer/data/hooks/useDataChange'
import { useAgentBrowserGuest } from '@renderer/hooks/agent/useAgentBrowserGuest'
import { useTabs } from '@renderer/hooks/tab'
import { useIpcOn } from '@renderer/ipc'
import { agentBrowserRuntimeService as runtime } from '@renderer/services/AgentBrowserRuntimeService'
import { getGuestAuthorizationKey } from '@renderer/utils/webviewGuest'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

import { WebviewHost } from './WebviewHost'
import { WebviewSurface } from './WebviewSurface'

const logger = loggerService.withContext('AgentBrowserRuntimeHost')

/** Window composition mounts this outside page Activity; the runtime owns its instances. */
export function AgentBrowserRuntimeHost() {
  const { tabs } = useTabs()
  const ids = useSyncExternalStore(runtime.subscribe, runtime.getIds)
  useEffect(() => runtime.reconcileOwners(new Set(tabs.map((tab) => tab.id))), [tabs])
  useEffect(() => () => runtime.dispose(), [])
  useDataChange('/agent-sessions', (effects) => {
    const changed = effects.filter((effect) => effect.kind === 'membership')
    if (!changed.length) return
    for (const sessionId of runtime.getIds()) {
      if (!changed.some((effect) => !effect.entityIds || effect.entityIds.includes(sessionId))) continue
      void dataApiService.get(`/agent-sessions/${sessionId}`).catch((error) => {
        if (isDataApiNotFoundError(error)) runtime.close(sessionId)
        else logger.debug('Failed to check browser session owner', { sessionId, error })
      })
    }
  })
  useIpcOn('browser.guest.ensure_requested', ({ sessionId, url }) => {
    runtime.ensure(sessionId, url)
  })
  return ids.map((sessionId) => <AgentBrowserGuest key={sessionId} sessionId={sessionId} />)
}

const AgentBrowserGuest = memo(function AgentBrowserGuest({ sessionId }: { sessionId: string }) {
  const resource = useSyncExternalStore(runtime.subscribe, () => runtime.get(sessionId))
  const guest = resource?.guest ?? null
  useAgentBrowserGuest(sessionId, guest, 0)
  const onWebviewChange = useCallback(
    (webview: WebviewTag | null) => runtime.update(sessionId, { guest: webview, ready: false, title: '' }),
    [sessionId]
  )
  const onOverlaysChange = useCallback(
    (overlays: HTMLDivElement | null) => runtime.update(sessionId, { overlays }),
    [sessionId]
  )
  if (!resource) return null
  const { sourceUrl, securityProfile, anchor } = resource
  const authorization = getGuestAuthorizationKey(securityProfile, sourceUrl)
  return (
    <WebviewSurface anchor={anchor}>
      <WebviewHost
        key={authorization}
        id={`agent-browser:${sessionId}`}
        src={sourceUrl}
        reloadKey={resource.reloadKey}
        securityProfile={securityProfile}
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
      <div ref={onOverlaysChange} className="contents" />
    </WebviewSurface>
  )
})
